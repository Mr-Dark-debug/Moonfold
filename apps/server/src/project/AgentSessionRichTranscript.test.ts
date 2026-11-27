// @effect-diagnostics nodeBuiltinImport:off -- fixtures write real transcript files for the plain Node parsers.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeZlib from "node:zlib";

import { ProviderInstanceId } from "@moonfold/contracts";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  parseAntigravityRichTranscript,
  parseClaudeRichTranscript,
  parseCodexRichTranscript,
  parsePiRichTranscript,
  readAntigravitySummariesFromRoot,
  readQuickTranscriptSummary,
  stageAntigravitySessionDb,
} from "./AgentSessionRichTranscript.ts";

const tempDirs: Array<string> = [];

function makeTempDir(prefix: string): string {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("AgentSessionRichTranscript", () => {
  it("parses Claude Code transcripts with messages, thinking, and paired tool calls", async () => {
    const dir = makeTempDir("moonfold-rich-claude-");
    const sessionId = "50f6346a-2a6e-4dc7-9121-ba869cc25d43";
    const filePath = NodePath.join(dir, `${sessionId}.jsonl`);
    const lines = [
      JSON.stringify({
        type: "user",
        sessionId,
        cwd: "/repo/app",
        timestamp: "2026-09-01T10:00:00.000Z",
        message: { role: "user", content: "Inspect tests and fix parser bug" },
      }),
      JSON.stringify({
        type: "user",
        sessionId,
        isSidechain: true,
        timestamp: "2026-09-01T10:00:01.000Z",
        message: { role: "user", content: "Sidechain noise" },
      }),
      JSON.stringify({
        type: "assistant",
        sessionId,
        timestamp: "2026-09-01T10:00:02.000Z",
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [
            { type: "thinking", thinking: "Let me run vitest and inspect parser.ts." },
            {
              type: "tool_use",
              id: "toolu_bash_1",
              name: "Bash",
              input: { command: "vp test run parser.test.ts" },
            },
            {
              type: "tool_use",
              id: "toolu_edit_1",
              name: "Edit",
              input: {
                file_path: "src/parser.ts",
                old_string: "return null;",
                new_string: "return parsed;",
              },
            },
            {
              type: "tool_use",
              id: "toolu_grep_1",
              name: "Grep",
              input: { pattern: "parseRich" },
            },
            {
              type: "tool_use",
              id: "toolu_web_1",
              name: "WebSearch",
              input: { query: "zstd node zlib" },
            },
          ],
        },
      }),
      JSON.stringify({
        type: "user",
        sessionId,
        timestamp: "2026-09-01T10:00:04.000Z",
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "toolu_bash_1", content: "1 passed" },
            {
              type: "tool_result",
              tool_use_id: "toolu_edit_1",
              content: "Edit failed: mismatch",
              is_error: true,
            },
            { type: "tool_result", tool_use_id: "toolu_grep_1", content: "src/parser.ts:12" },
          ],
        },
      }),
      JSON.stringify({
        type: "assistant",
        sessionId,
        timestamp: "2026-09-01T10:00:05.000Z",
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [{ type: "text", text: "Fixed the parser and verified tests pass." }],
        },
      }),
      JSON.stringify({
        type: "custom-title",
        sessionId,
        customTitle: "Fix parser bug",
      }),
    ];
    NodeFS.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");

    const parsed = await parseClaudeRichTranscript({
      filePath,
      providerInstanceId: ProviderInstanceId.make("claudeAgent"),
      fallbackSessionId: sessionId,
      lastActiveAtMs: Date.parse("2026-09-01T10:00:05.000Z"),
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.title).toBe("Fix parser bug");
    expect(parsed?.cwd).toBe("/repo/app");
    expect(parsed?.model).toBe("claude-sonnet-4-6");
    expect(parsed?.messageCount).toBe(2);
    expect(parsed?.reasoningCount).toBe(1);
    expect(parsed?.toolCallCount).toBe(4);
    expect(parsed?.items.map((item) => item.kind)).toEqual([
      "user_message",
      "reasoning",
      "command_execution",
      "file_change",
      "file_search",
      "web_search",
      "assistant_message",
    ]);
    expect(parsed?.items[2]).toMatchObject({
      kind: "command_execution",
      input: "vp test run parser.test.ts",
      output: "1 passed",
      status: "completed",
    });
    expect(parsed?.items[3]).toMatchObject({
      kind: "file_change",
      fileName: "src/parser.ts",
      oldStr: "return null;",
      newStr: "return parsed;",
      status: "failed",
    });
  });

  it("decompresses and parses Codex .jsonl.zst transcripts including reasoning, shell, and patches", async () => {
    const dir = makeTempDir("moonfold-rich-codex-");
    const sessionId = "01a19c31-bc7d-7e52-90a9-948cb9884be2";
    const filePath = NodePath.join(dir, `rollout-2026-09-01T10-00-00-${sessionId}.jsonl.zst`);
    const lines = [
      JSON.stringify({
        timestamp: "2026-09-01T10:00:00.000Z",
        type: "session_meta",
        payload: { id: sessionId, cwd: "/repo/codex-app", source: "cli" },
      }),
      JSON.stringify({
        timestamp: "2026-09-01T10:00:01.000Z",
        type: "turn_context",
        payload: { model: "gpt-5.3-codex", cwd: "/repo/codex-app" },
      }),
      JSON.stringify({
        timestamp: "2026-09-01T10:00:02.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "Patch README and run git status" },
      }),
      JSON.stringify({
        timestamp: "2026-09-01T10:00:03.000Z",
        type: "response_item",
        payload: {
          type: "reasoning",
          summary: [{ type: "summary_text", text: "Checking repository state first." }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-09-01T10:00:04.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: "call_cmd_1",
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "git status -s" }),
        },
      }),
      JSON.stringify({
        timestamp: "2026-09-01T10:00:05.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call_cmd_1",
          output: " M README.md",
        },
      }),
      JSON.stringify({
        timestamp: "2026-09-01T10:00:06.000Z",
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          call_id: "call_patch_1",
          name: "apply_patch",
          input: "*** Begin Patch\n*** Update File: README.md\n@@\n-old\n+new\n*** End Patch",
        },
      }),
      JSON.stringify({
        timestamp: "2026-09-01T10:00:07.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Updated README.md and checked git status." }],
        },
      }),
    ];
    const compressed = NodeZlib.zstdCompressSync(Buffer.from(`${lines.join("\n")}\n`, "utf8"));
    NodeFS.writeFileSync(filePath, compressed);

    const summary = await readQuickTranscriptSummary({
      source: "codex",
      filePath,
      fallbackSessionId: sessionId,
      mtimeMs: Date.parse("2026-09-01T10:00:07.000Z"),
    });
    expect(summary).toMatchObject({
      sessionId,
      cwd: "/repo/codex-app",
      model: "gpt-5.3-codex",
      title: "Patch README and run git status",
    });

    const parsed = await parseCodexRichTranscript({
      filePath,
      providerInstanceId: ProviderInstanceId.make("codex"),
      fallbackSessionId: sessionId,
      lastActiveAtMs: Date.parse("2026-09-01T10:00:07.000Z"),
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.messageCount).toBe(2);
    expect(parsed?.reasoningCount).toBe(1);
    expect(parsed?.toolCallCount).toBe(2);
    expect(parsed?.items.map((item) => item.kind)).toEqual([
      "user_message",
      "reasoning",
      "command_execution",
      "file_change",
      "assistant_message",
    ]);
    expect(parsed?.items[2]).toMatchObject({
      kind: "command_execution",
      input: "git status -s",
      output: " M README.md",
      status: "completed",
    });
    expect(parsed?.items[3]).toMatchObject({
      kind: "file_change",
      fileName: "README.md",
    });
  });

  it("discovers and parses Antigravity sessions from SQLite + transcript.jsonl and stages session DB safely", async () => {
    const rootDir = makeTempDir("moonfold-rich-ag-");
    const sessionId = "6c9006cf-78cc-422f-9287-4b65c59220e8";
    const logsDir = NodePath.join(rootDir, "brain", sessionId, ".system_generated", "logs");
    const conversationsDir = NodePath.join(rootDir, "conversations");
    NodeFS.mkdirSync(logsDir, { recursive: true });
    NodeFS.mkdirSync(conversationsDir, { recursive: true });

    const transcriptPath = NodePath.join(logsDir, "transcript.jsonl");
    const transcriptLines = [
      JSON.stringify({
        step_index: 1,
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        created_at: "2026-09-01T11:00:00.000Z",
        content: "<user_request>Build session importer</user_request>",
      }),
      JSON.stringify({
        step_index: 2,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        created_at: "2026-09-01T11:00:05.000Z",
        thinking: "First inspect the scanner and run tests.",
        content: "Starting implementation now.",
        tool_calls: [
          {
            name: "run_command",
            arguments: { CommandLine: "vp test run scanner.test.ts" },
          },
          {
            name: "replace_file_content",
            arguments: {
              TargetFile: "/repo/moonfold/scanner.ts",
              TargetContent: "old",
              ReplacementContent: "new",
            },
          },
        ],
      }),
      JSON.stringify({
        step_index: 3,
        source: "SYSTEM",
        type: "TOOL_RESULT",
        status: "DONE",
        created_at: "2026-09-01T11:00:06.000Z",
        content: "All scanner tests passed.",
      }),
    ];
    NodeFS.writeFileSync(transcriptPath, `${transcriptLines.join("\n")}\n`, "utf8");

    const sourceDbPath = NodePath.join(conversationsDir, `${sessionId}.db`);
    NodeFS.writeFileSync(sourceDbPath, "sqlite-placeholder", "utf8");
    NodeFS.writeFileSync(`${sourceDbPath}-wal`, "wal-placeholder", "utf8");

    const summaryDbPath = NodePath.join(rootDir, "conversation_summaries.db");
    const db = new NodeSqlite.DatabaseSync(summaryDbPath);
    try {
      db.exec(`
        CREATE TABLE conversations (
          conversation_id TEXT PRIMARY KEY,
          title TEXT,
          preview TEXT,
          last_modified_time INTEGER,
          workspace_uris TEXT,
          parent_conversation_id TEXT
        );
      `);
      db.prepare(
        `INSERT INTO conversations (conversation_id, title, preview, last_modified_time, workspace_uris, parent_conversation_id)
         VALUES (?, ?, ?, ?, ?, NULL)`,
      ).run(
        sessionId,
        "Session Importer Plan",
        "Build session importer",
        Date.parse("2026-09-01T11:00:06.000Z"),
        JSON.stringify(["file:///D:/projects/Moonfold"]),
      );
    } finally {
      db.close();
    }

    const summaries = readAntigravitySummariesFromRoot(rootDir);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      sessionId,
      title: "Session Importer Plan",
      transcriptPath,
      dbPath: sourceDbPath,
      isSubagent: false,
    });

    const parsed = await parseAntigravityRichTranscript({
      summary: summaries[0]!,
      providerInstanceId: ProviderInstanceId.make("antigravity"),
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.title).toBe("Session Importer Plan");
    expect(parsed?.messageCount).toBe(2);
    expect(parsed?.reasoningCount).toBe(1);
    expect(parsed?.toolCallCount).toBe(2);
    expect(parsed?.items.map((item) => item.kind)).toEqual([
      "user_message",
      "reasoning",
      "command_execution",
      "file_change",
      "assistant_message",
    ]);
    expect(parsed?.items[2]).toMatchObject({
      kind: "command_execution",
      input: "vp test run scanner.test.ts",
      output: "All scanner tests passed.",
      status: "completed",
    });

    const targetProfileDir = makeTempDir("moonfold-ag-profile-");
    const staged = await stageAntigravitySessionDb({
      sourceDbPath,
      targetProfileDir,
      sessionId,
      cwd: "/repo/moonfold",
    });
    expect(staged).toBe(true);
    const targetDb = NodePath.join(
      targetProfileDir,
      "antigravity-acp",
      "conversations",
      `${sessionId}.db`,
    );
    const targetMeta = NodePath.join(
      targetProfileDir,
      "antigravity-acp",
      "conversations",
      `${sessionId}.meta`,
    );
    expect(NodeFS.readFileSync(targetDb, "utf8")).toBe("sqlite-placeholder");
    expect(NodeFS.readFileSync(`${targetDb}-wal`, "utf8")).toBe("wal-placeholder");
    expect(JSON.parse(NodeFS.readFileSync(targetMeta, "utf8"))).toEqual({ cwd: "/repo/moonfold" });

    // Never overwrites an existing target DB on repeated import.
    NodeFS.writeFileSync(targetDb, "existing-modified", "utf8");
    await stageAntigravitySessionDb({
      sourceDbPath,
      targetProfileDir,
      sessionId,
      cwd: "/repo/moonfold",
    });
    expect(NodeFS.readFileSync(targetDb, "utf8")).toBe("existing-modified");
  });

  it("parses Pi active branch transcripts", async () => {
    const dir = makeTempDir("moonfold-rich-pi-");
    const sessionId = "pi-session-123";
    const filePath = NodePath.join(dir, `${sessionId}.jsonl`);
    const lines = [
      JSON.stringify({
        type: "session",
        id: sessionId,
        cwd: "/repo/pi",
        timestamp: "2026-09-01T12:00:00.000Z",
      }),
      JSON.stringify({ type: "session_info", name: "Pi Refactor" }),
      JSON.stringify({
        type: "message",
        id: "m1",
        timestamp: "2026-09-01T12:00:01.000Z",
        message: { role: "user", content: "Refactor util" },
      }),
      JSON.stringify({
        type: "message",
        id: "m2-abandoned",
        parentId: "m1",
        timestamp: "2026-09-01T12:00:02.000Z",
        message: { role: "assistant", content: "Abandoned branch" },
      }),
      JSON.stringify({
        type: "message",
        id: "m2-active",
        parentId: "m1",
        timestamp: "2026-09-01T12:00:03.000Z",
        message: { role: "assistant", model: "pi-fast", content: "Done refactoring util." },
      }),
    ];
    NodeFS.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");

    const parsed = await parsePiRichTranscript({
      filePath,
      providerInstanceId: ProviderInstanceId.make("pi"),
      fallbackSessionId: sessionId,
      lastActiveAtMs: Date.parse("2026-09-01T12:00:03.000Z"),
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.title).toBe("Pi Refactor");
    expect(parsed?.model).toBe("pi-fast");
    expect(parsed?.items).toEqual([
      { kind: "user_message", text: "Refactor util", createdAt: "2026-09-01T12:00:01.000Z" },
      {
        kind: "assistant_message",
        text: "Done refactoring util.",
        createdAt: "2026-09-01T12:00:03.000Z",
      },
    ]);
  });
});
