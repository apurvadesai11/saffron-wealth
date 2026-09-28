// Contrast-ratio arithmetic for the accessibility assertions, so a control's
// colour is checked against WCAG's actual threshold rather than eyeballed.
//
// happy-dom does not load Tailwind's stylesheet, so a computed `color` is not
// available in a unit test. The class name IS the source of truth for the
// colour here (Tailwind classes must appear as full strings in this codebase —
// see CLAUDE.md), so the class is resolved through the palette below and the
// ratio computed from the resulting hex. The real rendered box is asserted in
// Playwright instead.

// Tailwind v3 default palette, only the greys these controls use.
export const TAILWIND_GRAY: Record<string, string> = {
  "gray-300": "#d1d5db",
  "gray-400": "#9ca3af",
  "gray-500": "#6b7280",
  "gray-600": "#4b5563",
  "gray-700": "#374151",
  "gray-800": "#1f2937",
};

export const WHITE = "#ffffff";

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

/** The `text-gray-NNN` class on `el`, or null if it carries none. */
export function textGrayClass(el: Element): string | null {
  const match = el.className.match(/text-(gray-\d{3})\b/);
  return match ? match[1] : null;
}
