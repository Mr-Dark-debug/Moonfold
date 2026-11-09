import { TYPE_ROLES } from "./tokens.ts";

const token = (value: unknown) => ({ $value: value });

const role = (size: number, lineHeight: number, weight: number, tracking: number) => ({
  size: token(size),
  lineHeight: token(lineHeight),
  weight: token(weight),
  tracking: token(tracking),
});

/** A complete kit `tokens.json` that passes validation; tests break one part at a time. */
export const passingTokens = () => ({
  color: {
    primitive: {
      blue: { "400": token("#60a5fa"), "700": token("#1d4ed8") },
    },
    light: {
      background: token("#ffffff"),
      foreground: token("#111111"),
      primary: token("{color.primitive.blue.700}"),
      "primary-foreground": token("#ffffff"),
      accent: token("rgb(190 24 93)"),
      muted: token("#f1f5f9"),
      "muted-foreground": token("#475569"),
      border: token("#94a3b8"),
      success: token("#15803d"),
      warning: token("#b45309"),
      danger: token("#b91c1c"),
      focus: token("#2563eb"),
    },
    dark: {
      background: token("#0b0f19"),
      foreground: token("#f8fafc"),
      primary: token("oklch(0.72 0.15 250)"),
      "primary-foreground": token("#0b0f19"),
      accent: token("#f472b6"),
      muted: token("#1e293b"),
      "muted-foreground": token("#94a3b8"),
      border: token("#334155"),
      success: token("#4ade80"),
      warning: token("#fbbf24"),
      danger: token("#f87171"),
      focus: token("{color.primitive.blue.400}"),
    },
  },
  typography: {
    family: {
      sans: token(["Inter Tight", "system-ui", "sans-serif"]),
      mono: token("ui-monospace, monospace"),
    },
    role: Object.fromEntries(
      TYPE_ROLES.map((name, index) => [
        name,
        role(40 - index * 2, 1.4, 400 + (index % 3) * 100, 0),
      ]),
    ),
  },
  space: { "1": token(4), "2": token("8px"), "0.5": token({ value: 2, unit: "px" }) },
  radius: { sm: token("4px"), lg: token(12) },
  motion: { fast: token("120ms") },
});
