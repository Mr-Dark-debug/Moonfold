import { describe, expect, it } from "vite-plus/test";

describe("settings routes", () => {
  it("sit inside the chat layout, which holds the settings dialog and its providers", () => {
    // A `routes/settings.<page>.tsx` file renders full-window without SettingsScopeProvider and
    // crashes; each page belongs in `routes/_chat.settings.<page>.tsx`.
    const outside = Object.keys(import.meta.glob("./routes/settings.*.tsx"));
    expect(outside).toEqual([]);
    expect(Object.keys(import.meta.glob("./routes/_chat.settings.memories.tsx"))).toHaveLength(1);
  });
});
