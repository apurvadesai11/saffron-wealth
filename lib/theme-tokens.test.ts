import { describe, expect, it } from "vitest";
import defaultColors from "tailwindcss/colors";
import { CATEGORICAL_PALETTE, THEME_TOKENS, TOKEN_NAMES, hexToChannels, tokenVar } from "./theme-tokens";

// The shade each light token was converted from. The screenshot gate
// (e2e/visual.spec.ts) proves the conversion for the states it captures; this
// covers the ones it can't reach, such as hover and disabled.
const LIGHT_SOURCE_SHADE: Record<string, string> = {
  canvas: "gray-50", surface: "white", "surface-sunken": "gray-50", "surface-muted": "gray-100",
  "surface-strong": "gray-200", inverse: "gray-800",
  "line-faint": "gray-50", "line-subtle": "gray-100", line: "gray-200", "line-strong": "gray-300",
  fg: "gray-900", "fg-soft": "gray-800", "fg-secondary": "gray-700", "fg-tertiary": "gray-600",
  "fg-muted": "gray-500", "fg-faint": "gray-400", "fg-disabled": "gray-300", "fg-ghost": "gray-200",
  "on-solid": "white",
  accent: "blue-600", "accent-strong": "blue-700", "accent-muted": "blue-500", "accent-ring": "blue-500",
  "accent-soft": "blue-50", "accent-line": "blue-300",
  danger: "red-600", "danger-strong": "red-700", "danger-muted": "red-500", "danger-soft": "red-50",
  "danger-line-soft": "red-100", "danger-line": "red-200", "danger-line-strong": "red-400",
  success: "green-600", "success-strong": "green-700", "success-soft": "green-50", gain: "emerald-600",
  warning: "amber-600", "warning-strong": "amber-700", "warning-muted": "amber-500", "warning-soft": "amber-50",
  "warning-line-soft": "amber-100", "warning-line": "amber-200", "warning-line-strong": "amber-400",
  caution: "orange-600", "caution-muted": "orange-500", "caution-soft": "orange-50",
  "data-good": "green-500", "data-caution": "yellow-400", "data-warn": "orange-400",
  "data-over": "red-500", "data-over-deep": "red-700",
  scrim: "black",
};

function tailwindHex(shade: string): string {
  const [hue, step] = shade.split("-");
  const value = (defaultColors as unknown as Record<string, string | Record<string, string>>)[hue];
  const hex = (typeof value === "string" ? value : value[step]).toLowerCase();
  // Tailwind writes white and black in shorthand.
  return hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join("")}` : hex;
}

describe("light tokens", () => {
  it("names a source shade for every token", () => {
    expect(Object.keys(LIGHT_SOURCE_SHADE).sort()).toEqual([...TOKEN_NAMES].filter((t) => t !== "fg-base").sort());
  });

  it.each(Object.entries(LIGHT_SOURCE_SHADE))("%s is exactly %s", (token, shade) => {
    const hex = (THEME_TOKENS.light as Record<string, string>)[token];
    expect(hex).toBe(tailwindHex(shade));
  });

  it("fg-base is the body colour globals.css used before tokens", () => {
    expect(THEME_TOKENS.light["fg-base"]).toBe("#171717");
  });
});

describe("categorical palette", () => {
  it("keeps Tailwind's exact value for every class stored in Category.color", () => {
    for (const [hue, steps] of Object.entries(CATEGORICAL_PALETTE)) {
      for (const [step, hex] of Object.entries(steps)) {
        expect(hex).toBe(tailwindHex(`${hue}-${step}`));
      }
    }
  });
});

describe("hexToChannels", () => {
  it("splits a hex colour into space-separated decimal channels", () => {
    expect(hexToChannels("#2563eb")).toBe("37 99 235");
    expect(hexToChannels("#ffffff")).toBe("255 255 255");
    expect(hexToChannels("#000000")).toBe("0 0 0");
  });
});

describe("tokenVar", () => {
  it("prefixes the token so it cannot collide with other custom properties", () => {
    expect(tokenVar("fg-muted")).toBe("--c-fg-muted");
  });
});
