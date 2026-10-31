import { describe, expect, it } from "vitest";
import defaultColors from "tailwindcss/colors";
import { contrastRatio } from "@/components/__tests__/contrast";
import { CATEGORICAL_PALETTE, THEME_TOKENS, TOKEN_NAMES, hexToChannels, tokenVar, type ThemeToken } from "./theme-tokens";

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
  accent: "blue-600", "accent-strong": "blue-700", "accent-solid": "blue-600", "accent-solid-hover": "blue-700", "accent-muted": "blue-500", "accent-ring": "blue-500",
  "accent-soft": "blue-50", "accent-line": "blue-300",
  danger: "red-600", "danger-strong": "red-700", "danger-muted": "red-500", "danger-soft": "red-50",
  "danger-line-soft": "red-100", "danger-line": "red-200", "danger-line-strong": "red-400", "danger-solid": "red-500",
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

describe("dark tokens", () => {
  const light = THEME_TOKENS.light as Record<string, string>;
  const dark = THEME_TOKENS.dark as Record<string, string>;
  const onSurface = (theme: Record<string, string>, token: ThemeToken) =>
    contrastRatio(theme[token], theme.surface);

  it("defines exactly the same tokens as light", () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
  });

  it("puts each layer above the page lighter than the one below it", () => {
    // Shadows barely register on a dark page, so elevation is brightness.
    const luminanceOrder: ThemeToken[] = ["canvas", "surface", "surface-muted", "surface-strong"];
    const ratios = luminanceOrder.map((t) => contrastRatio(dark[t], "#000000"));
    expect(ratios).toEqual([...ratios].sort((a, b) => a - b));
    expect(new Set(ratios).size).toBe(ratios.length);
  });

  // Each text token keeps at least the contrast it has in light mode, capped at
  // 7:1 — near-black on white is ~18:1, and no dark surface can match that
  // without being black.
  const TEXT_TOKENS: ThemeToken[] = [
    "fg-base", "fg", "fg-soft", "fg-secondary", "fg-tertiary", "fg-muted", "fg-faint", "fg-disabled",
    "accent", "accent-strong", "accent-muted",
    "danger", "danger-strong", "danger-muted",
    "success", "success-strong", "gain",
    "warning", "warning-strong", "warning-muted",
    "caution", "caution-muted",
  ];
  it.each(TEXT_TOKENS)("%s stays as readable on a dark surface as it is on a light one", (token) => {
    const target = Math.min(onSurface(light, token), 7);
    expect(onSurface(dark, token)).toBeGreaterThanOrEqual(target);
  });

  // Fills that carry white text keep the contrast they have in light mode.
  const SOLID_FILLS: ThemeToken[] = ["accent-solid", "accent-solid-hover", "danger-solid", "inverse"];
  it.each(SOLID_FILLS)("white text on %s is no worse than in light mode", (token) => {
    expect(contrastRatio(dark["on-solid"], dark[token])).toBeGreaterThanOrEqual(
      Math.min(contrastRatio(light["on-solid"], light[token]), 7),
    );
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
