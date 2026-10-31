// Contrast-ratio arithmetic for the accessibility assertions, so a control's
// colour is checked against WCAG's actual threshold rather than eyeballed.
//
// happy-dom does not load Tailwind's stylesheet, so a computed `color` is not
// available in a unit test. The class name IS the source of truth for the
// colour here (Tailwind classes must appear as full strings in this codebase —
// see CLAUDE.md), so the token in the class is resolved through
// lib/theme-tokens.ts — the same module the stylesheet is generated from — and
// the ratio computed from the resulting hex. The real rendered box is asserted
// in Playwright instead.

import { THEME_TOKENS, TOKEN_NAMES, type ThemeName, type ThemeToken } from "@/lib/theme-tokens";

export function tokenHex(token: ThemeToken, theme: ThemeName = "light"): string {
  return THEME_TOKENS[theme][token];
}

// Longest first, so `text-fg-muted` resolves to fg-muted rather than fg.
const TOKENS_LONGEST_FIRST = [...TOKEN_NAMES].sort((a, b) => b.length - a.length);

/** The colour token in `el`'s `text-*` class, or null if it carries none. */
export function textTokenClass(el: Element): ThemeToken | null {
  const classes = el.className.split(/\s+/);
  for (const token of TOKENS_LONGEST_FIRST) {
    if (classes.includes(`text-${token}`)) return token;
  }
  return null;
}

function channelLuminance(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  );
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [light, dark] = la > lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}
