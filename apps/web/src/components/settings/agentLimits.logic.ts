/** One non-empty path per line, without repeats. */
export function parseContentExclusions(text: string): ReadonlyArray<string> {
  return [
    ...new Set(
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== ""),
    ),
  ];
}

/** A whole number of tokens; anything else means no limit. Thousands separators are fine. */
export function parseRunTokenLimit(text: string): number | null {
  const digits = text.replaceAll(/[\s,_]/g, "");
  if (!/^\d+$/.test(digits)) return null;
  const limit = Number(digits);
  return Number.isSafeInteger(limit) && limit >= 1 ? limit : null;
}
