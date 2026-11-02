import { describe, expect, it } from "vite-plus/test";

import { parseContentExclusions, parseRunTokenLimit } from "./agentLimits.logic";

describe("parseContentExclusions", () => {
  it("keeps one trimmed path per line and drops blanks and repeats", () => {
    expect(parseContentExclusions(" .env \r\n\r\nsecrets/**\n.env\n")).toEqual([
      ".env",
      "secrets/**",
    ]);
  });
});

describe("parseRunTokenLimit", () => {
  it("reads whole numbers, with separators", () => {
    expect(parseRunTokenLimit("200000")).toBe(200_000);
    expect(parseRunTokenLimit(" 200,000 ")).toBe(200_000);
  });

  it("treats empty, zero and non-numbers as no limit", () => {
    expect(parseRunTokenLimit("")).toBeNull();
    expect(parseRunTokenLimit("0")).toBeNull();
    expect(parseRunTokenLimit("1.5")).toBeNull();
    expect(parseRunTokenLimit("lots")).toBeNull();
    expect(parseRunTokenLimit("99999999999999999999")).toBeNull();
  });
});
