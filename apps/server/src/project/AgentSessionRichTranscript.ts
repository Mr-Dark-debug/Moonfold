// @effect-diagnostics nodeBuiltinImport:off globalDate:off -- streaming zstd decompression and read-only SQLite reads have no Effect wrapper.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";
import * as NodeSqlite from "node:sqlite";
import * as NodeURL from "node:url";
import * as NodeZlib from "node:zlib";

import type { AgentSessionSource, ProviderInstanceId } from "@moonfold/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

const MAX_RICH_TIMELINE_ITEMS = 2_000;
const MAX_LINE_BYTES = 16 * 1024 * 1024;
const MAX_TOOL_TEXT_CHARS = 16_000;
const MAX_MESSAGE_TEXT_CHARS = 256_000;
const MAX_PREVIEW_PROMPT_CHARS = 320;
const MAX_RECORDS_PER_TRANSCRIPT = 100_000;

const CODEX_TITLE_PREAMBLE =
  /^(?:\s*(?:<(recommended_plugins|environment_context|user_instructions|INSTRUCTIONS|in-app-browser-context)(?:\s[^>]*)?>[\s\S]*?<\/\1>|# AGENTS\.md instructions\b[^\n]*|## My request for Codex:))+/;

export type AgentSessionTimelineItem =
  | {
      readonly kind: "user_message";
      readonly text: string;
      readonly createdAt: string;
    }
  | {
      readonly kind: "assistant_message";
      readonly text: string;
      readonly createdAt: string;
    }
  | {
      readonly kind: "reasoning";
      readonly text: string;
      readonly createdAt: string;
    }
  | {
      readonly kind: "command_execution";
      readonly input: string;
      readonly output?: string;
      readonly status: "completed" | "failed";
      readonly createdAt: string;
    }
  | {
      readonly kind: "file_change";
      readonly fileName: string;
      readonly oldStr?: string;
      readonly newStr?: string;
      readonly diffStr?: string;
      readonly status: "completed" | "failed";
      readonly createdAt: string;
    }
  | {
      readonly kind: "file_search";
      readonly pattern?: string;
      readonly status: "completed" | "failed";
      readonly createdAt: string;
    }
  | {
      readonly kind: "web_search";
      readonly patterns?: ReadonlyArray<string>;
      readonly status: "completed" | "failed";
      readonly createdAt: string;
    }
  | {
      readonly kind: "dynamic_tool";
      readonly toolName: string;
      readonly title?: string;
      readonly input?: unknown;
      readonly output?: unknown;
      readonly status: "completed" | "failed";
      readonly createdAt: string;
    };

export interface AgentSessionRichThread {
  readonly source: AgentSessionSource;
  readonly providerInstanceId: ProviderInstanceId;
  readonly providerSessionId: string;
  readonly title: string;
  readonly cwd: string | null;
  readonly model: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly items: ReadonlyArray<AgentSessionTimelineItem>;
  readonly messageCount: number;
  readonly toolCallCount: number;
  readonly reasoningCount: number;
  readonly omittedItemCount: number;
  readonly firstUserPrompt: string | null;
  readonly sourceFilePath: string;
  readonly antigravityDbPath?: string;
}

export interface AntigravityConversationSummary {
  readonly sessionId: string;
  readonly title: string;
  readonly cwd: string | null;
  readonly updatedAtMs: number;
  readonly rootDir: string;
  readonly transcriptPath: string | null;
  readonly dbPath: string | null;
  readonly isSubagent: boolean;
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n… (truncated)`;
}

function normalizeIsoTimestamp(value: unknown, fallbackIso: string): string {
  if (typeof value !== "string" || value.trim().length === 0) return fallbackIso;
  const parsed = DateTime.make(value.trim());
  if (Option.isSome(parsed)) return DateTime.formatIso(parsed.value);
  const ms = Date.parse(value.trim());
  if (Number.isFinite(ms)) return new Date(ms).toISOString();
  return fallbackIso;
}

function parseTimestampMs(value: unknown, fallbackMs: number): number {
  if (typeof value !== "string" || value.trim().length === 0) return fallbackMs;
  const ms = Date.parse(value.trim());
  return Number.isFinite(ms) ? ms : fallbackMs;
}

function deriveTitleFromPrompt(source: AgentSessionSource, text: string): string | undefined {
  const cleaned = source === "codex" ? text.replace(CODEX_TITLE_PREAMBLE, "") : text;
  return cleaned.trim().split("\n")[0]?.slice(0, 100).trim() || undefined;
}

function unwrapAntigravityUserInput(raw: string): string {
  const trimmed = raw.trim();
  const userRequestMatch = /<user_request>\s*([\s\S]*?)\s*<\/user_request>/i.exec(trimmed);
  if (userRequestMatch?.[1]) {
    return userRequestMatch[1].trim();
  }
  const stripped = trimmed
    .replace(/<moonfold_instructions>[\s\S]*?<\/moonfold_instructions>/gi, "")
    .replace(/<runtime_info>[\s\S]*?<\/runtime_info>/gi, "")
    .replace(/^<moonfold_instructions>[\s\S]*$/i, "")
    .trim();
  return stripped;
}

function parseWorkspaceUriToPath(uri: string): string | null {
  const trimmed = uri.trim();
  if (trimmed.length === 0) return null;
  if (!trimmed.startsWith("file://")) return trimmed;
  try {
    return NodeURL.fileURLToPath(trimmed);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  return value;
}

function extractPlainTextFromContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  const parts: Array<string> = [];
  for (const block of content) {
    const record = asRecord(block);
    if (!record) continue;
    const type = record.type;
    if (
      (type === "text" || type === "input_text" || type === "output_text") &&
      typeof record.text === "string"
    ) {
      const trimmed = record.text.trim();
      if (trimmed.length > 0) parts.push(trimmed);
    }
  }
  return parts.join("\n");
}

function extractPatchFileName(patchText: string): string {
  const match = /^\*\*\*\s+(?:Update|Add|Delete)\s+File:\s*(.+)$/m.exec(patchText);
  return match?.[1]?.trim() || "patch";
}

function sanitizeToolValue(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return truncateText(value, MAX_TOOL_TEXT_CHARS);
  if (typeof value === "number" || typeof value === "boolean") return value;
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length <= MAX_TOOL_TEXT_CHARS) return value;
    return truncateText(serialized, MAX_TOOL_TEXT_CHARS);
  } catch {
    return undefined;
  }
}

export async function readZstdPrefixUtf8(filePath: string, maxBytes: number): Promise<string> {
  return await new Promise((resolve) => {
    const chunks: Array<Buffer> = [];
    let total = 0;
    let settled = false;
    const fileStream = NodeFS.createReadStream(filePath);
    const decompress = NodeZlib.createZstdDecompress();
    const done = () => {
      if (settled) return;
      settled = true;
      fileStream.destroy();
      decompress.destroy();
      resolve(Buffer.concat(chunks, total).toString("utf8"));
    };
    fileStream.on("error", done);
    decompress.on("error", done);
    decompress.on("data", (chunk: Buffer) => {
      const remaining = maxBytes - total;
      if (remaining <= 0) {
        done();
        return;
      }
      const slice = chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk;
      chunks.push(slice);
      total += slice.byteLength;
      if (total >= maxBytes) done();
    });
    decompress.on("end", done);
    fileStream.pipe(decompress);
  });
}

async function forEachJsonlLine(
  filePath: string,
  onLine: (line: string) => boolean | void,
): Promise<void> {
  const isZstd = filePath.toLowerCase().endsWith(".zst");
  const fileStream = NodeFS.createReadStream(filePath);
  fileStream.on("error", () => {});
  const inputStream = isZstd ? fileStream.pipe(NodeZlib.createZstdDecompress()) : fileStream;
  if (inputStream !== fileStream) {
    inputStream.on("error", () => {});
  }
  const rl = NodeReadline.createInterface({
    input: inputStream,
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  let count = 0;
  try {
    for await (const line of rl) {
      if (line.length === 0 || line.length > MAX_LINE_BYTES) continue;
      count += 1;
      if (count > MAX_RECORDS_PER_TRANSCRIPT) break;
      const keepGoing = onLine(line);
      if (keepGoing === false) break;
    }
  } catch {
    // Ignore stream truncation / EOF errors after partial reads or early break.
  } finally {
    rl.close();
    inputStream.destroy();
    fileStream.destroy();
  }
}

interface TimelineCollector {
  readonly push: (item: AgentSessionTimelineItem) => number;
  readonly get: (index: number) => AgentSessionTimelineItem | undefined;
  readonly replace: (index: number, item: AgentSessionTimelineItem) => void;
  readonly finalize: () => {
    readonly items: ReadonlyArray<AgentSessionTimelineItem>;
    readonly messageCount: number;
    readonly toolCallCount: number;
    readonly reasoningCount: number;
    readonly omittedItemCount: number;
    readonly firstUserPrompt: string | null;
  };
}

function createTimelineCollector(maxItems: number): TimelineCollector {
  const allItems: Array<AgentSessionTimelineItem> = [];
  let firstUserItem: Extract<AgentSessionTimelineItem, { readonly kind: "user_message" }> | null =
    null;
  let totalCount = 0;
  let droppedPrefix = 0;

  return {
    push(item) {
      if (firstUserItem === null && item.kind === "user_message") {
        firstUserItem = item;
      }
      const logicalIndex = totalCount;
      totalCount += 1;
      allItems.push(item);
      if (allItems.length > maxItems) {
        allItems.shift();
        droppedPrefix += 1;
      }
      return logicalIndex;
    },
    get(logicalIndex) {
      const localIndex = logicalIndex - droppedPrefix;
      return localIndex >= 0 && localIndex < allItems.length ? allItems[localIndex] : undefined;
    },
    replace(logicalIndex, item) {
      const localIndex = logicalIndex - droppedPrefix;
      if (localIndex >= 0 && localIndex < allItems.length) {
        allItems[localIndex] = item;
      }
    },
    finalize() {
      let retained: ReadonlyArray<AgentSessionTimelineItem> = allItems;
      if (firstUserItem !== null && !allItems.includes(firstUserItem)) {
        retained = [firstUserItem, ...allItems.slice(-(maxItems - 1))];
      }
      let messageCount = 0;
      let toolCallCount = 0;
      let reasoningCount = 0;
      for (const item of retained) {
        if (item.kind === "user_message" || item.kind === "assistant_message") {
          messageCount += 1;
        } else if (item.kind === "reasoning") {
          reasoningCount += 1;
        } else {
          toolCallCount += 1;
        }
      }
      return {
        items: retained,
        messageCount,
        toolCallCount,
        reasoningCount,
        omittedItemCount: Math.max(0, totalCount - retained.length),
        firstUserPrompt: firstUserItem
          ? truncateText(firstUserItem.text, MAX_PREVIEW_PROMPT_CHARS)
          : null,
      };
    },
  };
}

function mapClaudeToolUse(
  name: string,
  input: Record<string, unknown> | null,
  createdAt: string,
): AgentSessionTimelineItem {
  const lower = name.toLowerCase();
  if (lower === "bash" || lower === "shell") {
    const command = asNonEmptyString(input?.command) ?? asNonEmptyString(input?.cmd) ?? name;
    return {
      kind: "command_execution",
      input: truncateText(command, MAX_TOOL_TEXT_CHARS),
      status: "completed",
      createdAt,
    };
  }
  if (lower === "edit" || lower === "write" || lower === "multiedit" || lower === "notebookedit") {
    const fileName =
      asNonEmptyString(input?.file_path) ??
      asNonEmptyString(input?.notebook_path) ??
      asNonEmptyString(input?.path) ??
      name;
    const oldStr =
      typeof input?.old_string === "string"
        ? truncateText(input.old_string, MAX_TOOL_TEXT_CHARS)
        : undefined;
    const newStr =
      typeof input?.new_string === "string"
        ? truncateText(input.new_string, MAX_TOOL_TEXT_CHARS)
        : typeof input?.content === "string"
          ? truncateText(input.content, MAX_TOOL_TEXT_CHARS)
          : undefined;
    return {
      kind: "file_change",
      fileName,
      ...(oldStr === undefined ? {} : { oldStr }),
      ...(newStr === undefined ? {} : { newStr }),
      status: "completed",
      createdAt,
    };
  }
  if (lower === "grep" || lower === "glob") {
    const pattern = asNonEmptyString(input?.pattern);
    return {
      kind: "file_search",
      ...(pattern === undefined ? {} : { pattern }),
      status: "completed",
      createdAt,
    };
  }
  if (lower === "websearch") {
    const query = asNonEmptyString(input?.query);
    return {
      kind: "web_search",
      ...(query === undefined ? {} : { patterns: [query] }),
      status: "completed",
      createdAt,
    };
  }
  return {
    kind: "dynamic_tool",
    toolName: name,
    ...(input === null ? {} : { input: sanitizeToolValue(input) }),
    status: "completed",
    createdAt,
  };
}

function applyToolResultToItem(
  item: AgentSessionTimelineItem,
  outputText: string,
  failed: boolean,
): AgentSessionTimelineItem {
  const status = failed ? ("failed" as const) : ("completed" as const);
  const clipped = outputText.length > 0 ? truncateText(outputText, MAX_TOOL_TEXT_CHARS) : undefined;
  switch (item.kind) {
    case "command_execution":
      return { ...item, status, ...(clipped === undefined ? {} : { output: clipped }) };
    case "dynamic_tool":
      return { ...item, status, ...(clipped === undefined ? {} : { output: clipped }) };
    case "file_change":
    case "file_search":
    case "web_search":
      return { ...item, status };
    default:
      return item;
  }
}

export async function parseClaudeRichTranscript(input: {
  readonly filePath: string;
  readonly providerInstanceId: ProviderInstanceId;
  readonly fallbackSessionId: string;
  readonly lastActiveAtMs: number;
}): Promise<AgentSessionRichThread | null> {
  const fallbackIso = new Date(input.lastActiveAtMs).toISOString();
  const collector = createTimelineCollector(MAX_RICH_TIMELINE_ITEMS);
  const toolIndexById = new Map<string, number>();

  let sessionId = input.fallbackSessionId;
  let cwd: string | null = null;
  let aiTitle: string | null = null;
  let customTitle: string | null = null;
  let model: string | null = null;
  let derivedTitle: string | undefined;

  await forEachJsonlLine(input.filePath, (line) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    const record = asRecord(parsed);
    if (!record) return;
    if (record.isSidechain === true || record.isMeta === true || record.isCompactSummary === true) {
      return;
    }
    const sid = asNonEmptyString(record.sessionId);
    if (sid) sessionId = sid;
    if (cwd === null) {
      const recordCwd = asNonEmptyString(record.cwd);
      if (recordCwd) cwd = recordCwd;
    }
    const recordAiTitle = asNonEmptyString(record.aiTitle);
    if (recordAiTitle) aiTitle = recordAiTitle;
    if (record.customTitle !== undefined) {
      customTitle = asNonEmptyString(record.customTitle) ?? null;
    }

    const type = record.type;
    if (type !== "user" && type !== "assistant") return;
    const message = asRecord(record.message);
    if (!message) return;
    const msgModel = asNonEmptyString(message.model);
    if (msgModel && msgModel !== "<synthetic>") model = msgModel;

    const createdAt = normalizeIsoTimestamp(record.timestamp, fallbackIso);
    const content = message.content;

    if (type === "user") {
      if (typeof content === "string") {
        const text = content.trim();
        if (text.length > 0) {
          if (derivedTitle === undefined) derivedTitle = deriveTitleFromPrompt("claudeAgent", text);
          collector.push({
            kind: "user_message",
            text: truncateText(text, MAX_MESSAGE_TEXT_CHARS),
            createdAt,
          });
        }
        return;
      }
      if (!Array.isArray(content)) return;
      const textParts: Array<string> = [];
      for (const rawBlock of content) {
        const block = asRecord(rawBlock);
        if (!block) continue;
        if (block.type === "tool_result") {
          const toolUseId = asNonEmptyString(block.tool_use_id);
          if (toolUseId) {
            const existingIndex = toolIndexById.get(toolUseId);
            if (existingIndex !== undefined) {
              const existingItem = collector.get(existingIndex);
              if (existingItem) {
                const outputText = extractPlainTextFromContent(block.content);
                collector.replace(
                  existingIndex,
                  applyToolResultToItem(existingItem, outputText, block.is_error === true),
                );
              }
            }
          }
        } else if (block.type === "text" && typeof block.text === "string") {
          const trimmed = block.text.trim();
          if (trimmed.length > 0) textParts.push(trimmed);
        }
      }
      if (textParts.length > 0) {
        const joined = textParts.join("\n");
        if (derivedTitle === undefined) derivedTitle = deriveTitleFromPrompt("claudeAgent", joined);
        collector.push({
          kind: "user_message",
          text: truncateText(joined, MAX_MESSAGE_TEXT_CHARS),
          createdAt,
        });
      }
      return;
    }

    // assistant record
    if (typeof content === "string") {
      const text = content.trim();
      if (text.length > 0) {
        collector.push({
          kind: "assistant_message",
          text: truncateText(text, MAX_MESSAGE_TEXT_CHARS),
          createdAt,
        });
      }
      return;
    }
    if (!Array.isArray(content)) return;
    for (const rawBlock of content) {
      const block = asRecord(rawBlock);
      if (!block) continue;
      if (block.type === "thinking" && typeof block.thinking === "string") {
        const text = block.thinking.trim();
        if (text.length > 0) {
          collector.push({
            kind: "reasoning",
            text: truncateText(text, MAX_MESSAGE_TEXT_CHARS),
            createdAt,
          });
        }
      } else if (block.type === "text" && typeof block.text === "string") {
        const text = block.text.trim();
        if (text.length > 0) {
          collector.push({
            kind: "assistant_message",
            text: truncateText(text, MAX_MESSAGE_TEXT_CHARS),
            createdAt,
          });
        }
      } else if (block.type === "tool_use") {
        const name = asNonEmptyString(block.name) ?? "tool";
        const toolItem = mapClaudeToolUse(name, asRecord(block.input), createdAt);
        const idx = collector.push(toolItem);
        const toolId = asNonEmptyString(block.id);
        if (toolId) toolIndexById.set(toolId, idx);
      }
    }
  });

  const finalized = collector.finalize();
  if (finalized.items.length === 0) return null;

  return {
    source: "claudeAgent",
    providerInstanceId: input.providerInstanceId,
    providerSessionId: sessionId,
    title: customTitle ?? aiTitle ?? derivedTitle ?? "Imported Claude thread",
    cwd,
    model,
    createdAt: finalized.items[0]?.createdAt ?? fallbackIso,
    updatedAt: finalized.items.at(-1)?.createdAt ?? fallbackIso,
    ...finalized,
    sourceFilePath: input.filePath,
  };
}

function mapCodexToolCall(
  name: string,
  rawArgs: unknown,
  createdAt: string,
): AgentSessionTimelineItem {
  const lower = name.toLowerCase();
  const parsedArgs = parseMaybeJson(rawArgs);
  const argsRecord = asRecord(parsedArgs);

  if (
    lower === "exec" ||
    lower === "shell" ||
    lower === "shell_command" ||
    lower === "exec_command" ||
    lower === "bash" ||
    lower === "local_shell"
  ) {
    let command: string | undefined;
    if (typeof parsedArgs === "string") {
      command = parsedArgs.trim();
    } else if (argsRecord) {
      if (Array.isArray(argsRecord.command)) {
        command = argsRecord.command.map(String).join(" ");
      } else {
        command =
          asNonEmptyString(argsRecord.cmd) ??
          asNonEmptyString(argsRecord.command) ??
          asNonEmptyString(argsRecord.script);
      }
    }
    return {
      kind: "command_execution",
      input: truncateText(command || name, MAX_TOOL_TEXT_CHARS),
      status: "completed",
      createdAt,
    };
  }

  if (lower === "apply_patch") {
    const patchText =
      typeof parsedArgs === "string"
        ? parsedArgs
        : (asNonEmptyString(argsRecord?.patch) ?? asNonEmptyString(argsRecord?.input) ?? "");
    return {
      kind: "file_change",
      fileName: extractPatchFileName(patchText),
      ...(patchText.length > 0 ? { diffStr: truncateText(patchText, MAX_TOOL_TEXT_CHARS) } : {}),
      status: "completed",
      createdAt,
    };
  }

  if (lower === "web_search") {
    const query = asNonEmptyString(argsRecord?.query) ?? asNonEmptyString(argsRecord?.q);
    return {
      kind: "web_search",
      ...(query === undefined ? {} : { patterns: [query] }),
      status: "completed",
      createdAt,
    };
  }

  return {
    kind: "dynamic_tool",
    toolName: name,
    ...(parsedArgs === undefined ? {} : { input: sanitizeToolValue(parsedArgs) }),
    status: "completed",
    createdAt,
  };
}

export async function parseCodexRichTranscript(input: {
  readonly filePath: string;
  readonly providerInstanceId: ProviderInstanceId;
  readonly fallbackSessionId: string;
  readonly lastActiveAtMs: number;
  readonly savedTitle?: string;
}): Promise<AgentSessionRichThread | null> {
  const fallbackIso = new Date(input.lastActiveAtMs).toISOString();
  const collector = createTimelineCollector(MAX_RICH_TIMELINE_ITEMS);
  const toolIndexByCallId = new Map<string, number>();

  let sessionId = input.fallbackSessionId;
  let hasSessionId = false;
  let cwd: string | null = null;
  let model: string | null = null;
  let derivedTitle: string | undefined;
  let lastUserMessageText: string | null = null;
  let lastUserMessageWasEvent = false;

  await forEachJsonlLine(input.filePath, (line) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    const record = asRecord(parsed);
    if (!record) return;
    const type = record.type;
    const payload = asRecord(record.payload);
    if (!payload) return;
    const createdAt = normalizeIsoTimestamp(record.timestamp, fallbackIso);

    if (type === "session_meta") {
      const sid = asNonEmptyString(payload.id) ?? asNonEmptyString(payload.session_id);
      if (!hasSessionId && sid) {
        sessionId = sid;
        hasSessionId = true;
      }
      if (cwd === null) {
        const metaCwd = asNonEmptyString(payload.cwd);
        if (metaCwd) cwd = metaCwd;
      }
      return;
    }

    if (type === "turn_context") {
      const turnModel = asNonEmptyString(payload.model);
      if (turnModel) model = turnModel;
      if (cwd === null) {
        const turnCwd = asNonEmptyString(payload.cwd);
        if (turnCwd) cwd = turnCwd;
      }
      return;
    }

    if (type === "event_msg" && payload.type === "user_message") {
      const text = typeof payload.message === "string" ? payload.message.trim() : "";
      if (text.length === 0) return;
      if (derivedTitle === undefined) derivedTitle = deriveTitleFromPrompt("codex", text);
      if (!lastUserMessageWasEvent && lastUserMessageText === text) {
        lastUserMessageWasEvent = true;
        return;
      }
      lastUserMessageText = text;
      lastUserMessageWasEvent = true;
      collector.push({
        kind: "user_message",
        text: truncateText(text, MAX_MESSAGE_TEXT_CHARS),
        createdAt,
      });
      return;
    }

    if (type !== "response_item") return;
    const payloadType = payload.type;

    if (payloadType === "message") {
      const role = payload.role;
      if (role !== "user" && role !== "assistant") return;
      const text = extractPlainTextFromContent(payload.content);
      if (text.length === 0) return;
      if (role === "user") {
        // Skip duplicated user prompt when event_msg already emitted it.
        if (lastUserMessageWasEvent && lastUserMessageText === text) return;
        // Skip Codex internal setup preambles if the whole message is only preamble.
        if (text.replace(CODEX_TITLE_PREAMBLE, "").trim().length === 0) return;
        if (derivedTitle === undefined) derivedTitle = deriveTitleFromPrompt("codex", text);
        lastUserMessageText = text;
        lastUserMessageWasEvent = false;
        collector.push({
          kind: "user_message",
          text: truncateText(text, MAX_MESSAGE_TEXT_CHARS),
          createdAt,
        });
      } else {
        lastUserMessageText = null;
        lastUserMessageWasEvent = false;
        collector.push({
          kind: "assistant_message",
          text: truncateText(text, MAX_MESSAGE_TEXT_CHARS),
          createdAt,
        });
      }
      return;
    }

    if (payloadType === "reasoning") {
      const summary = Array.isArray(payload.summary) ? payload.summary : [];
      const parts: Array<string> = [];
      for (const entry of summary) {
        const entryRecord = asRecord(entry);
        const text = asNonEmptyString(entryRecord?.text);
        if (text) parts.push(text);
      }
      if (parts.length > 0) {
        collector.push({
          kind: "reasoning",
          text: truncateText(parts.join("\n"), MAX_MESSAGE_TEXT_CHARS),
          createdAt,
        });
      }
      return;
    }

    if (payloadType === "function_call" || payloadType === "custom_tool_call") {
      const name = asNonEmptyString(payload.name) ?? "tool";
      const rawArgs = payloadType === "function_call" ? payload.arguments : payload.input;
      const item = mapCodexToolCall(name, rawArgs, createdAt);
      const idx = collector.push(item);
      const callId = asNonEmptyString(payload.call_id);
      if (callId) toolIndexByCallId.set(callId, idx);
      return;
    }

    if (payloadType === "local_shell_call") {
      const action = asRecord(payload.action);
      const cmd = Array.isArray(action?.command)
        ? action.command.map(String).join(" ")
        : (asNonEmptyString(action?.command) ?? "shell");
      const idx = collector.push({
        kind: "command_execution",
        input: truncateText(cmd, MAX_TOOL_TEXT_CHARS),
        status: payload.status === "failed" ? "failed" : "completed",
        createdAt,
      });
      const callId = asNonEmptyString(payload.call_id);
      if (callId) toolIndexByCallId.set(callId, idx);
      return;
    }

    if (payloadType === "function_call_output" || payloadType === "custom_tool_call_output") {
      const callId = asNonEmptyString(payload.call_id);
      if (!callId) return;
      const existingIndex = toolIndexByCallId.get(callId);
      if (existingIndex === undefined) return;
      const existingItem = collector.get(existingIndex);
      if (!existingItem) return;
      const outputText =
        typeof payload.output === "string"
          ? payload.output
          : extractPlainTextFromContent(payload.output);
      collector.replace(existingIndex, applyToolResultToItem(existingItem, outputText, false));
    }
  });

  const finalized = collector.finalize();
  if (finalized.items.length === 0) return null;

  return {
    source: "codex",
    providerInstanceId: input.providerInstanceId,
    providerSessionId: sessionId,
    title: input.savedTitle?.trim() || derivedTitle || "Imported Codex thread",
    cwd,
    model,
    createdAt: finalized.items[0]?.createdAt ?? fallbackIso,
    updatedAt: finalized.items.at(-1)?.createdAt ?? fallbackIso,
    ...finalized,
    sourceFilePath: input.filePath,
  };
}

function unquoteAntigravityArg(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = parseMaybeJson(value);
  if (typeof parsed === "string") return parsed.trim() || undefined;
  return value.trim() || undefined;
}

function mapAntigravityToolCall(
  toolCall: Record<string, unknown>,
  createdAt: string,
): AgentSessionTimelineItem {
  const name = asNonEmptyString(toolCall.name) ?? "tool";
  const args = asRecord(toolCall.args) ?? asRecord(toolCall.arguments);
  const title = unquoteAntigravityArg(args?.toolSummary) ?? unquoteAntigravityArg(args?.toolAction);

  if (name === "run_command") {
    const command = unquoteAntigravityArg(args?.CommandLine) ?? name;
    return {
      kind: "command_execution",
      input: truncateText(command, MAX_TOOL_TEXT_CHARS),
      status: "completed",
      createdAt,
    };
  }
  if (
    name === "replace_file_content" ||
    name === "multi_replace_file_content" ||
    name === "write_to_file"
  ) {
    const fileName = unquoteAntigravityArg(args?.TargetFile) ?? name;
    const oldStr = unquoteAntigravityArg(args?.TargetContent);
    const newStr =
      unquoteAntigravityArg(args?.ReplacementContent) ?? unquoteAntigravityArg(args?.CodeContent);
    return {
      kind: "file_change",
      fileName,
      ...(oldStr === undefined ? {} : { oldStr: truncateText(oldStr, MAX_TOOL_TEXT_CHARS) }),
      ...(newStr === undefined ? {} : { newStr: truncateText(newStr, MAX_TOOL_TEXT_CHARS) }),
      status: "completed",
      createdAt,
    };
  }
  if (name === "grep_search" || name === "find_by_name") {
    const pattern = unquoteAntigravityArg(args?.Query) ?? unquoteAntigravityArg(args?.Pattern);
    return {
      kind: "file_search",
      ...(pattern === undefined ? {} : { pattern }),
      status: "completed",
      createdAt,
    };
  }
  if (name === "search_web") {
    const query = unquoteAntigravityArg(args?.query);
    return {
      kind: "web_search",
      ...(query === undefined ? {} : { patterns: [query] }),
      status: "completed",
      createdAt,
    };
  }

  const normalizedArgs =
    args === null
      ? undefined
      : Object.fromEntries(
          Object.entries(args)
            .filter(([key]) => key !== "toolAction" && key !== "toolSummary")
            .map(([key, value]) => [key, parseMaybeJson(value)]),
        );
  return {
    kind: "dynamic_tool",
    toolName: name,
    ...(title === undefined ? {} : { title }),
    ...(normalizedArgs === undefined || Object.keys(normalizedArgs).length === 0
      ? {}
      : { input: sanitizeToolValue(normalizedArgs) }),
    status: "completed",
    createdAt,
  };
}

export function resolveAntigravityTranscriptPath(
  rootDir: string,
  sessionId: string,
): string | null {
  const logsDir = NodePath.join(rootDir, "brain", sessionId, ".system_generated", "logs");
  const primary = NodePath.join(logsDir, "transcript.jsonl");
  if (NodeFS.existsSync(primary)) return primary;
  const full = NodePath.join(logsDir, "transcript_full.jsonl");
  if (NodeFS.existsSync(full)) return full;
  return null;
}

export function resolveAntigravityDbPath(rootDir: string, sessionId: string): string | null {
  const dbPath = NodePath.join(rootDir, "conversations", `${sessionId}.db`);
  return NodeFS.existsSync(dbPath) ? dbPath : null;
}

export function readAntigravitySummariesFromRoot(
  rootDir: string,
): ReadonlyArray<AntigravityConversationSummary> {
  const results = new Map<string, AntigravityConversationSummary>();
  const summaryDbPath = NodePath.join(rootDir, "conversation_summaries.db");

  if (NodeFS.existsSync(summaryDbPath)) {
    let db: NodeSqlite.DatabaseSync | null = null;
    try {
      db = new NodeSqlite.DatabaseSync(summaryDbPath, { readOnly: true });
      const rows = db
        .prepare(
          `SELECT conversation_id, title, preview, last_modified_time, workspace_uris, parent_conversation_id
           FROM conversations
           ORDER BY last_modified_time DESC
           LIMIT 2000`,
        )
        .all() as ReadonlyArray<Record<string, unknown>>;

      for (const row of rows) {
        const sessionId = asNonEmptyString(row.conversation_id);
        if (!sessionId) continue;
        const parentId = asNonEmptyString(row.parent_conversation_id);
        let cwd: string | null = null;
        if (typeof row.workspace_uris === "string") {
          const parsed = parseMaybeJson(row.workspace_uris);
          if (Array.isArray(parsed)) {
            for (const uri of parsed) {
              if (typeof uri === "string") {
                const localPath = parseWorkspaceUriToPath(uri);
                if (localPath) {
                  cwd = localPath;
                  break;
                }
              }
            }
          }
        }
        const rawTitle = asNonEmptyString(row.title) ?? asNonEmptyString(row.preview) ?? sessionId;
        const transcriptPath = resolveAntigravityTranscriptPath(rootDir, sessionId);
        const dbPath = resolveAntigravityDbPath(rootDir, sessionId);
        if (transcriptPath === null && dbPath === null) continue;
        results.set(sessionId, {
          sessionId,
          title: rawTitle.slice(0, 120),
          cwd,
          updatedAtMs: parseTimestampMs(row.last_modified_time, Date.now()),
          rootDir,
          transcriptPath,
          dbPath,
          isSubagent: parentId !== undefined,
        });
      }
    } catch {
      // Fall back to filesystem scan if summary DB is missing or locked.
    } finally {
      db?.close();
    }
  }

  // Also scan `.meta` files (used by Moonfold-managed antigravity-acp profiles) and any brain transcripts not in the summary DB.
  const peekAntigravityTitle = (transcriptPath: string | null): string | null => {
    if (transcriptPath === null) return null;
    let fd: number | null = null;
    try {
      fd = NodeFS.openSync(transcriptPath, "r");
      const buffer = Buffer.allocUnsafe(32 * 1024);
      const bytesRead = NodeFS.readSync(fd, buffer, 0, buffer.length, 0);
      const chunk = buffer.subarray(0, bytesRead).toString("utf8");
      for (const rawLine of chunk.split("\n")) {
        const line = rawLine.trim();
        if (!line.startsWith("{")) continue;
        try {
          const rec = asRecord(JSON.parse(line));
          if (rec?.type === "USER_INPUT" && rec?.source === "USER_EXPLICIT") {
            const raw = typeof rec.content === "string" ? rec.content : "";
            const text = unwrapAntigravityUserInput(raw);
            if (text.length > 0) {
              return deriveTitleFromPrompt("antigravity", text) ?? null;
            }
          }
        } catch {
          // Partial trailing line in prefix buffer is fine.
        }
      }
    } catch {
      return null;
    } finally {
      if (fd !== null) {
        try {
          NodeFS.closeSync(fd);
        } catch {
          // Ignore close error.
        }
      }
    }
    return null;
  };

  const conversationsDir = NodePath.join(rootDir, "conversations");
  if (NodeFS.existsSync(conversationsDir)) {
    try {
      for (const entry of NodeFS.readdirSync(conversationsDir)) {
        if (!entry.endsWith(".meta")) continue;
        const sessionId = entry.slice(0, -".meta".length);
        if (results.has(sessionId)) continue;
        const metaPath = NodePath.join(conversationsDir, entry);
        let cwd: string | null = null;
        let updatedAtMs = Date.now();
        try {
          const stats = NodeFS.statSync(metaPath);
          updatedAtMs = stats.mtimeMs;
          const parsed = asRecord(JSON.parse(NodeFS.readFileSync(metaPath, "utf8")));
          cwd = asNonEmptyString(parsed?.cwd) ?? null;
        } catch {
          continue;
        }
        const transcriptPath = resolveAntigravityTranscriptPath(rootDir, sessionId);
        const dbPath = resolveAntigravityDbPath(rootDir, sessionId);
        if (transcriptPath === null && dbPath === null) continue;
        const title =
          peekAntigravityTitle(transcriptPath) ?? `Antigravity session ${sessionId.slice(0, 8)}`;
        results.set(sessionId, {
          sessionId,
          title,
          cwd,
          updatedAtMs,
          rootDir,
          transcriptPath,
          dbPath,
          isSubagent: false,
        });
      }
    } catch {
      // Ignore unreadable directories.
    }
  }

  const brainDir = NodePath.join(rootDir, "brain");
  if (NodeFS.existsSync(brainDir)) {
    try {
      for (const entry of NodeFS.readdirSync(brainDir)) {
        if (results.has(entry)) continue;
        const transcriptPath = resolveAntigravityTranscriptPath(rootDir, entry);
        if (transcriptPath === null) continue;
        let updatedAtMs = Date.now();
        try {
          updatedAtMs = NodeFS.statSync(transcriptPath).mtimeMs;
        } catch {
          // Ignore stat failures.
        }
        const title =
          peekAntigravityTitle(transcriptPath) ?? `Antigravity session ${entry.slice(0, 8)}`;
        results.set(entry, {
          sessionId: entry,
          title,
          cwd: null,
          updatedAtMs,
          rootDir,
          transcriptPath,
          dbPath: resolveAntigravityDbPath(rootDir, entry),
          isSubagent: false,
        });
      }
    } catch {
      // Ignore unreadable brain directory.
    }
  }

  return Array.from(results.values());
}

function readAntigravityFtsFallback(
  rootDir: string,
  sessionId: string,
  fallbackIso: string,
): ReadonlyArray<AgentSessionTimelineItem> {
  const summaryDbPath = NodePath.join(rootDir, "conversation_summaries.db");
  if (!NodeFS.existsSync(summaryDbPath)) return [];
  let db: NodeSqlite.DatabaseSync | null = null;
  try {
    db = new NodeSqlite.DatabaseSync(summaryDbPath, { readOnly: true });
    const rows = db
      .prepare(
        `SELECT user_body, agent_body, last_step_created_at
         FROM conversations_fts
         WHERE conversation_id = ?
         ORDER BY CAST(chunk_index AS INTEGER) ASC`,
      )
      .all(sessionId) as ReadonlyArray<Record<string, unknown>>;
    const items: Array<AgentSessionTimelineItem> = [];
    for (const row of rows) {
      const at = normalizeIsoTimestamp(row.last_step_created_at, fallbackIso);
      const userBody = asNonEmptyString(row.user_body);
      if (userBody) {
        items.push({
          kind: "user_message",
          text: truncateText(userBody, MAX_MESSAGE_TEXT_CHARS),
          createdAt: at,
        });
      }
      const agentBody = asNonEmptyString(row.agent_body);
      if (agentBody) {
        items.push({
          kind: "assistant_message",
          text: truncateText(agentBody, MAX_MESSAGE_TEXT_CHARS),
          createdAt: at,
        });
      }
    }
    return items;
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

export async function parseAntigravityRichTranscript(input: {
  readonly summary: AntigravityConversationSummary;
  readonly providerInstanceId: ProviderInstanceId;
}): Promise<AgentSessionRichThread | null> {
  const { summary } = input;
  const fallbackIso = new Date(summary.updatedAtMs).toISOString();
  const collector = createTimelineCollector(MAX_RICH_TIMELINE_ITEMS);

  let model: string | null = null;
  let derivedTitle: string | undefined;
  let pendingToolIndices: Array<number> = [];

  if (summary.transcriptPath !== null) {
    await forEachJsonlLine(summary.transcriptPath, (line) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        return;
      }
      const record = asRecord(parsed);
      if (!record) return;
      const type = record.type;
      const source = record.source;
      const createdAt = normalizeIsoTimestamp(record.created_at, fallbackIso);

      if (type === "USER_INPUT" && source === "USER_EXPLICIT") {
        pendingToolIndices = [];
        const raw = typeof record.content === "string" ? record.content : "";
        const text = unwrapAntigravityUserInput(raw);
        if (text.length === 0) return;
        if (derivedTitle === undefined) derivedTitle = deriveTitleFromPrompt("antigravity", text);
        collector.push({
          kind: "user_message",
          text: truncateText(text, MAX_MESSAGE_TEXT_CHARS),
          createdAt,
        });
        return;
      }

      if (type === "PLANNER_RESPONSE" && source === "MODEL") {
        pendingToolIndices = [];
        const stepModel = asNonEmptyString(record.model);
        if (stepModel) model = stepModel;
        if (typeof record.thinking === "string" && record.thinking.trim().length > 0) {
          collector.push({
            kind: "reasoning",
            text: truncateText(record.thinking.trim(), MAX_MESSAGE_TEXT_CHARS),
            createdAt,
          });
        }
        if (Array.isArray(record.tool_calls)) {
          for (const rawTool of record.tool_calls) {
            const toolRecord = asRecord(rawTool);
            if (!toolRecord) continue;
            const idx = collector.push(mapAntigravityToolCall(toolRecord, createdAt));
            pendingToolIndices.push(idx);
          }
        }
        if (typeof record.content === "string" && record.content.trim().length > 0) {
          collector.push({
            kind: "assistant_message",
            text: truncateText(record.content.trim(), MAX_MESSAGE_TEXT_CHARS),
            createdAt,
          });
        }
        return;
      }

      if ((type === "GENERIC" || type === "TOOL_RESULT") && pendingToolIndices.length > 0) {
        const targetIndex = pendingToolIndices.shift();
        if (targetIndex !== undefined) {
          const existing = collector.get(targetIndex);
          const outputText = typeof record.content === "string" ? record.content.trim() : "";
          if (existing && outputText.length > 0) {
            collector.replace(
              targetIndex,
              applyToolResultToItem(existing, outputText, record.status === "ERROR"),
            );
          }
        }
      }
    });
  }

  let finalized = collector.finalize();
  if (finalized.items.length === 0) {
    const fallbackItems = readAntigravityFtsFallback(
      summary.rootDir,
      summary.sessionId,
      fallbackIso,
    );
    for (const item of fallbackItems) {
      collector.push(item);
    }
    finalized = collector.finalize();
  }

  if (finalized.items.length === 0 && summary.dbPath === null) return null;

  const title =
    summary.title && !summary.title.startsWith("Antigravity session ")
      ? summary.title
      : (derivedTitle ?? summary.title ?? "Imported Antigravity thread");

  return {
    source: "antigravity",
    providerInstanceId: input.providerInstanceId,
    providerSessionId: summary.sessionId,
    title,
    cwd: summary.cwd,
    model,
    createdAt: finalized.items[0]?.createdAt ?? fallbackIso,
    updatedAt: finalized.items.at(-1)?.createdAt ?? fallbackIso,
    ...finalized,
    sourceFilePath: summary.transcriptPath ?? summary.dbPath ?? summary.rootDir,
    ...(summary.dbPath === null ? {} : { antigravityDbPath: summary.dbPath }),
  };
}

export async function parsePiRichTranscript(input: {
  readonly filePath: string;
  readonly providerInstanceId: ProviderInstanceId;
  readonly fallbackSessionId: string;
  readonly lastActiveAtMs: number;
}): Promise<AgentSessionRichThread | null> {
  const fallbackIso = new Date(input.lastActiveAtMs).toISOString();
  const rawRecords: Array<Record<string, unknown>> = [];
  let sessionId = input.fallbackSessionId;
  let cwd: string | null = null;
  let title: string | null = null;
  let model: string | null = null;

  await forEachJsonlLine(input.filePath, (line) => {
    try {
      const record = asRecord(JSON.parse(line));
      if (!record) return;
      if (record.type === "session") {
        const sid = asNonEmptyString(record.id);
        if (sid) sessionId = sid;
        const recordCwd = asNonEmptyString(record.cwd);
        if (recordCwd) cwd = recordCwd;
      } else if (record.type === "session_info") {
        title = asNonEmptyString(record.name) ?? null;
      } else {
        rawRecords.push(record);
      }
    } catch {
      // Ignore malformed lines.
    }
  });

  // Walk active branch from leaf to root.
  let branch = rawRecords;
  const leaf = rawRecords.at(-1);
  if (leaf && typeof leaf.id === "string") {
    const byId = new Map<string, Record<string, unknown>>();
    for (const rec of rawRecords) {
      if (typeof rec.id === "string") byId.set(rec.id, rec);
    }
    const walked: Array<Record<string, unknown>> = [];
    let current: Record<string, unknown> | undefined = leaf;
    while (current !== undefined && walked.length < rawRecords.length) {
      walked.push(current);
      const parentId: string | undefined =
        typeof current.parentId === "string" ? current.parentId : undefined;
      current = parentId ? byId.get(parentId) : undefined;
    }
    branch = walked.toReversed();
  }

  const collector = createTimelineCollector(MAX_RICH_TIMELINE_ITEMS);
  let derivedTitle: string | undefined;

  for (const record of branch) {
    if (record.type !== "message") continue;
    const message = asRecord(record.message);
    if (!message) continue;
    const role = message.role;
    if (role !== "user" && role !== "assistant") continue;
    const msgModel = asNonEmptyString(message.model);
    if (msgModel) model = msgModel;
    const createdAt = normalizeIsoTimestamp(record.timestamp, fallbackIso);
    const text = extractPlainTextFromContent(message.content);
    if (text.length === 0) continue;
    if (role === "user") {
      if (derivedTitle === undefined) derivedTitle = deriveTitleFromPrompt("pi", text);
      collector.push({
        kind: "user_message",
        text: truncateText(text, MAX_MESSAGE_TEXT_CHARS),
        createdAt,
      });
    } else {
      collector.push({
        kind: "assistant_message",
        text: truncateText(text, MAX_MESSAGE_TEXT_CHARS),
        createdAt,
      });
    }
  }

  const finalized = collector.finalize();
  if (finalized.items.length === 0) return null;

  return {
    source: "pi",
    providerInstanceId: input.providerInstanceId,
    providerSessionId: sessionId,
    title: title ?? derivedTitle ?? "Imported Pi thread",
    cwd,
    model,
    createdAt: finalized.items[0]?.createdAt ?? fallbackIso,
    updatedAt: finalized.items.at(-1)?.createdAt ?? fallbackIso,
    ...finalized,
    sourceFilePath: input.filePath,
  };
}

export interface QuickTranscriptSummary {
  readonly sessionId: string;
  readonly title: string;
  readonly cwd: string | null;
  readonly model: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly excluded?: boolean;
}

const QUICK_SUMMARY_PREFIX_BYTES = 64 * 1024;
const QUICK_SUMMARY_TAIL_BYTES = 16 * 1024;

async function readPlainPrefixUtf8(filePath: string, maxBytes: number): Promise<string> {
  let handle: NodeFS.promises.FileHandle | null = null;
  try {
    handle = await NodeFS.promises.open(filePath, "r");
    const buffer = Buffer.allocUnsafe(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } catch {
    return "";
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function readPlainTailUtf8(filePath: string, maxBytes: number): Promise<string> {
  let handle: NodeFS.promises.FileHandle | null = null;
  try {
    handle = await NodeFS.promises.open(filePath, "r");
    const stats = await handle.stat();
    const size = stats.size;
    if (size <= QUICK_SUMMARY_PREFIX_BYTES) return "";
    const start = Math.max(0, size - maxBytes);
    const len = size - start;
    const buffer = Buffer.allocUnsafe(len);
    const { bytesRead } = await handle.read(buffer, 0, len, start);
    const text = buffer.subarray(0, bytesRead).toString("utf8");
    const firstNewline = text.indexOf("\n");
    return firstNewline === -1 ? "" : text.slice(firstNewline + 1);
  } catch {
    return "";
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function readQuickTranscriptSummary(input: {
  readonly source: "claudeAgent" | "codex" | "pi";
  readonly filePath: string;
  readonly fallbackSessionId: string;
  readonly mtimeMs: number;
  readonly savedCodexTitle?: string;
}): Promise<QuickTranscriptSummary | null> {
  const fallbackIso = new Date(input.mtimeMs).toISOString();
  const isZstd = input.filePath.toLowerCase().endsWith(".zst");
  const prefix = isZstd
    ? await readZstdPrefixUtf8(input.filePath, QUICK_SUMMARY_PREFIX_BYTES)
    : await readPlainPrefixUtf8(input.filePath, QUICK_SUMMARY_PREFIX_BYTES);
  if (prefix.length === 0) return null;

  const lines = prefix.split("\n");
  if (!isZstd && input.source === "claudeAgent") {
    const tail = await readPlainTailUtf8(input.filePath, QUICK_SUMMARY_TAIL_BYTES);
    if (tail.length > 0) {
      lines.push(...tail.split("\n"));
    }
  }

  let sessionId = input.source === "codex" ? "" : input.fallbackSessionId;
  let cwd: string | null = null;
  let model: string | null = null;
  let title: string | null = null;
  let customTitle: string | null = null;
  let derivedTitle: string | undefined;
  let createdAt: string | null = null;
  let hasConversationContent = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const record = asRecord(parsed);
    if (!record) continue;

    if (input.source === "claudeAgent") {
      if (
        record.isSidechain === true ||
        record.isMeta === true ||
        record.isCompactSummary === true
      ) {
        continue;
      }
      const sid = asNonEmptyString(record.sessionId);
      if (sid) sessionId = sid;
      const recCwd = asNonEmptyString(record.cwd);
      if (recCwd && cwd === null) cwd = recCwd;
      const aiTitle = asNonEmptyString(record.aiTitle);
      if (aiTitle) title = aiTitle;
      if (typeof record.customTitle === "string") {
        customTitle = record.customTitle.trim() || null;
      }
      const message = asRecord(record.message);
      const recModel = asNonEmptyString(message?.model);
      if (recModel && recModel !== "<synthetic>") model = recModel;
      if (record.type === "user" || record.type === "assistant") {
        const text = extractPlainTextFromContent(message?.content);
        if (text.length > 0) {
          hasConversationContent = true;
          if (createdAt === null) createdAt = normalizeIsoTimestamp(record.timestamp, fallbackIso);
          if (derivedTitle === undefined && record.type === "user") {
            derivedTitle = deriveTitleFromPrompt("claudeAgent", text);
          }
        }
      }
      continue;
    }

    if (input.source === "codex") {
      const payload = asRecord(record.payload);
      if (record.type === "session_meta" && payload) {
        const sessionSource = payload.source;
        if (
          typeof sessionSource === "object" &&
          sessionSource !== null &&
          !Array.isArray(sessionSource) &&
          (Object.hasOwn(sessionSource, "subagent") || Object.hasOwn(sessionSource, "subAgent"))
        ) {
          return {
            sessionId: input.fallbackSessionId,
            title: "",
            cwd: null,
            model: null,
            createdAt: fallbackIso,
            updatedAt: fallbackIso,
            excluded: true,
          };
        }
        const sid = asNonEmptyString(payload.id) ?? asNonEmptyString(payload.session_id);
        if (sid && sessionId.length === 0) sessionId = sid;
        const recCwd = asNonEmptyString(payload.cwd);
        if (recCwd && cwd === null) cwd = recCwd;
        if (createdAt === null) createdAt = normalizeIsoTimestamp(record.timestamp, fallbackIso);
        continue;
      }
      if (record.type === "turn_context" && payload) {
        const recModel = asNonEmptyString(payload.model);
        if (recModel) model = recModel;
        const recCwd = asNonEmptyString(payload.cwd);
        if (recCwd && cwd === null) cwd = recCwd;
        continue;
      }
      if (record.type === "event_msg" && payload?.type === "user_message") {
        const text = asNonEmptyString(payload.message);
        if (text) {
          hasConversationContent = true;
          if (createdAt === null) createdAt = normalizeIsoTimestamp(record.timestamp, fallbackIso);
          if (derivedTitle === undefined) derivedTitle = deriveTitleFromPrompt("codex", text);
        }
        continue;
      }
      if (
        record.type === "response_item" &&
        payload?.type === "message" &&
        (payload.role === "user" || payload.role === "assistant")
      ) {
        const text = extractPlainTextFromContent(payload.content);
        if (text.length > 0) {
          hasConversationContent = true;
          if (createdAt === null) createdAt = normalizeIsoTimestamp(record.timestamp, fallbackIso);
          if (derivedTitle === undefined && payload.role === "user") {
            derivedTitle = deriveTitleFromPrompt("codex", text);
          }
        }
      }
      continue;
    }

    // Pi
    if (record.type === "session") {
      const sid = asNonEmptyString(record.id);
      if (sid) sessionId = sid;
      const recCwd = asNonEmptyString(record.cwd);
      if (recCwd && cwd === null) cwd = recCwd;
      if (createdAt === null) createdAt = normalizeIsoTimestamp(record.timestamp, fallbackIso);
    } else if (record.type === "session_info") {
      title = asNonEmptyString(record.name) ?? null;
    } else if (record.type === "message") {
      const message = asRecord(record.message);
      if (message && (message.role === "user" || message.role === "assistant")) {
        const recModel = asNonEmptyString(message.model);
        if (recModel) model = recModel;
        const text = extractPlainTextFromContent(message.content);
        if (text.length > 0) {
          hasConversationContent = true;
          if (createdAt === null) createdAt = normalizeIsoTimestamp(record.timestamp, fallbackIso);
          if (derivedTitle === undefined && message.role === "user") {
            derivedTitle = deriveTitleFromPrompt("pi", text);
          }
        }
      }
    }
  }

  const resolvedSessionId = sessionId.trim() || input.fallbackSessionId;
  if (!resolvedSessionId) return null;
  if (
    !hasConversationContent &&
    input.savedCodexTitle === undefined &&
    title === null &&
    customTitle === null
  ) {
    return null;
  }

  const finalTitle =
    (input.source === "codex" ? input.savedCodexTitle : undefined) ??
    customTitle ??
    title ??
    derivedTitle ??
    `Session ${resolvedSessionId.slice(0, 8)}`;

  return {
    sessionId: resolvedSessionId,
    title: finalTitle,
    cwd,
    model,
    createdAt: createdAt ?? fallbackIso,
    updatedAt: fallbackIso,
  };
}

export async function forEachDecompressedZstdLine(
  filePath: string,
  onLine: (line: string) => boolean | void,
): Promise<void> {
  await forEachJsonlLine(filePath, onLine);
}

/**
 * Safely stages an external Antigravity conversation SQLite database into a Moonfold
 * Antigravity instance profile (`<profile>/antigravity-acp/conversations/<sessionId>.db` + `.meta`)
 * so native ACP `session/resume` can continue the session. Never mutates source files and
 * never overwrites an existing target database.
 */
export async function stageAntigravitySessionDb(input: {
  readonly sourceDbPath: string;
  readonly targetProfileDir: string;
  readonly sessionId: string;
  readonly cwd: string;
}): Promise<boolean> {
  const conversationsDir = NodePath.join(
    input.targetProfileDir,
    "antigravity-acp",
    "conversations",
  );
  const targetDbPath = NodePath.join(conversationsDir, `${input.sessionId}.db`);
  const targetMetaPath = NodePath.join(conversationsDir, `${input.sessionId}.meta`);
  const resolvedSource = NodePath.resolve(input.sourceDbPath);
  const resolvedTarget = NodePath.resolve(targetDbPath);

  if (resolvedSource.toLowerCase() === resolvedTarget.toLowerCase()) {
    return true;
  }
  if (!NodeFS.existsSync(resolvedSource)) {
    return false;
  }

  try {
    await NodeFS.promises.mkdir(conversationsDir, { recursive: true });
    if (!NodeFS.existsSync(resolvedTarget)) {
      await NodeFS.promises.copyFile(resolvedSource, resolvedTarget);
      for (const suffix of ["-wal", "-shm"] as const) {
        const sidecarSource = `${resolvedSource}${suffix}`;
        const sidecarTarget = `${resolvedTarget}${suffix}`;
        if (NodeFS.existsSync(sidecarSource) && !NodeFS.existsSync(sidecarTarget)) {
          await NodeFS.promises.copyFile(sidecarSource, sidecarTarget);
        }
      }
    }
    if (!NodeFS.existsSync(targetMetaPath)) {
      await NodeFS.promises.writeFile(targetMetaPath, JSON.stringify({ cwd: input.cwd }), "utf8");
    }
    return true;
  } catch {
    return false;
  }
}

export function resolveAntigravityProfileDir(
  stateDir: string,
  instanceId: ProviderInstanceId,
): string {
  const key = NodeCrypto.createHash("sha256").update(instanceId).digest("hex");
  return NodePath.join(stateDir, "providers", "antigravity", key);
}
