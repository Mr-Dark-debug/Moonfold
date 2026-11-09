/**
 * Recognizes OpenCode's terminal quota/rate-limit failures: an SDK error (HTTP 429), a provider
 * error code, or a rate-limit message. Nested response bodies are inspected too, since some
 * providers wrap the original error.
 */
export function openCodeFailureClass(input: unknown): "usage_limit" | "provider_error" {
  const seen = new Set<object>();
  const queue: unknown[] = [input];
  const strings: string[] = [];
  let has429Status = false;

  while (queue.length > 0) {
    const value = queue.shift();
    if (typeof value === "string") {
      strings.push(value);
      // Some SDKs put a JSON response body inside the message.
      const trimmed = value.trim();
      if ((trimmed.startsWith("{") || trimmed.startsWith("[")) && trimmed.length < 20_000) {
        try {
          queue.push(JSON.parse(trimmed));
        } catch {
          // Plain provider text is still examined below.
        }
      }
      continue;
    }
    if (typeof value !== "object" || value === null || seen.has(value)) continue;
    seen.add(value);
    const record = value as Record<string, unknown>;
    // Error.message and Error.cause are often non-enumerable, so read known
    // fields directly as well as traversing enumerable response properties.
    for (const key of [
      "message",
      "detail",
      "code",
      "type",
      "name",
      "statusText",
      "body",
      "cause",
    ]) {
      const child = record[key];
      if (typeof child === "string") strings.push(child);
      else if (typeof child === "object" && child !== null) queue.push(child);
    }
    for (const [key, child] of Object.entries(record)) {
      if (
        ["status", "statusCode", "status_code", "httpStatus", "http_status"].includes(key) &&
        (child === 429 || child === "429")
      ) {
        has429Status = true;
      }
      if (typeof child === "string") {
        if (["message", "detail", "code", "type", "name", "statusText", "body"].includes(key)) {
          strings.push(child);
        }
        // Read nested JSON body strings even when the field name varies by SDK.
        if (child.trim().startsWith("{") && child.length < 20_000) queue.push(child);
      } else if (typeof child === "object" && child !== null) {
        queue.push(child);
      }
    }
  }

  if (has429Status) return "usage_limit";
  const text = strings.join("\n");
  return /rate[\s_-]*limit(?:[\s_-]*(?:exceeded|exhausted|reached|error))?|too many requests|quota(?:[\s_-]*(?:exceeded|exhausted|depleted|limit))|usage[\s_-]*(?:limit|exceeded)|freeusageLimitError|resource_exhausted|provider\.rate-limit|credits?[\s_-]*(?:depleted|exhausted)|rate_limit_exceeded/i.test(
    text,
  )
    ? "usage_limit"
    : "provider_error";
}
