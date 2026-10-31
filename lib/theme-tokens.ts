// The app's colour palette, as named roles rather than shades. Tailwind's
// default palette is replaced by these (tailwind.config.ts), so a component
// can say `text-fg-muted` but not `text-gray-500`, and a theme is one set of
// values here rather than a `dark:` variant on every class in the codebase.
//
// tailwind.config.ts generates the CSS variables from this module, and the
// contrast tests read it directly, so the stylesheet and the tests cannot
// disagree about what a token's colour is.
//
// The light values are exact copies of the Tailwind shades the components used
// before tokens existed — one token per (role, shade) pair, even where two
// tokens share a value — so converting a class to its token changed nothing on
// screen. Merging shades is a design change and should look like one.

export type ThemeName = "light" | "dark";

export const THEME_TOKENS = {
  light: {
    // Surfaces, darkest-to-lightest is not the order here: in light mode the
    // page sits *below* the cards, so `canvas` is grey and `surface` is white.
    canvas: "#f9fafb", // page background
    surface: "#ffffff", // cards, modals, header, sidebar
    "surface-sunken": "#f9fafb", // hover rows and inset panels on a card
    "surface-muted": "#f3f4f6", // progress tracks, selected tabs
    "surface-strong": "#e5e7eb",
    inverse: "#1f2937", // chart tooltip

    // Borders. `line` is also the preflight default for a bare `border`.
    "line-faint": "#f9fafb",
    "line-subtle": "#f3f4f6",
    line: "#e5e7eb",
    "line-strong": "#d1d5db",

    // Text, strongest first.
    "fg-base": "#171717", // inherited by text that names no colour
    fg: "#111827",
    "fg-soft": "#1f2937",
    "fg-secondary": "#374151",
    "fg-tertiary": "#4b5563",
    "fg-muted": "#6b7280", // the lightest grey that meets 3:1 for a control
    "fg-faint": "#9ca3af", // decorative and placeholder text only
    "fg-disabled": "#d1d5db",
    "fg-ghost": "#e5e7eb",
    "on-solid": "#ffffff", // text on accent, danger, inverse and avatar fills

    accent: "#2563eb", // links, chart line, selected text
    "accent-strong": "#1d4ed8",
    // Button fills. Separate from `accent` because text and fill want
    // different shades on a dark surface: text has to lighten to stay
    // readable, a fill has to stay dark enough for white text.
    "accent-solid": "#2563eb",
    "accent-solid-hover": "#1d4ed8",
    "accent-muted": "#3b82f6",
    "accent-ring": "#3b82f6",
    "accent-soft": "#eff6ff",
    "accent-line": "#93c5fd",

    danger: "#dc2626",
    "danger-strong": "#b91c1c",
    "danger-muted": "#ef4444",
    "danger-soft": "#fef2f2",
    "danger-line-soft": "#fee2e2",
    "danger-line": "#fecaca",
    "danger-line-strong": "#f87171",
    "danger-solid": "#ef4444", // the alert-count badge, under white text

    success: "#16a34a",
    "success-strong": "#15803d",
    "success-soft": "#f0fdf4",
    gain: "#059669", // positive deltas and "saved" confirmations

    warning: "#d97706",
    "warning-strong": "#b45309",
    "warning-muted": "#f59e0b",
    "warning-soft": "#fffbeb",
    "warning-line-soft": "#fef3c7",
    "warning-line": "#fde68a",
    "warning-line-strong": "#fbbf24",

    // Income-side counterpart of the Monthly Review's earned/spent/net cards.
    caution: "#ea580c",
    "caution-muted": "#f97316",
    "caution-soft": "#fff7ed",

    // Fills where the colour is the data: budget progress bars and the
    // income/expense dots. Kept saturated in every theme.
    "data-good": "#22c55e",
    "data-caution": "#facc15",
    "data-warn": "#fb923c",
    "data-over": "#ef4444",
    "data-over-deep": "#b91c1c",

    scrim: "#000000", // always used with an opacity modifier
  },
  // Not an inversion of light. Elevation reverses — shadows barely show on a
  // dark page, so hierarchy comes from brightness: the page is darkest and each
  // layer above it is lighter. Text and status hues move up their ramps to stay
  // readable; fills that carry white text stay dark. The contrast rule each
  // text token must keep is in theme-tokens.test.ts.
  dark: {
    canvas: "#0b0f17",
    surface: "#131a26",
    "surface-sunken": "#0f1520",
    "surface-muted": "#1f2937",
    "surface-strong": "#2b3647",
    inverse: "#2b3647",

    "line-faint": "#182131",
    "line-subtle": "#1f2937",
    line: "#2b3647",
    "line-strong": "#3a4658",

    "fg-base": "#e5e7eb",
    fg: "#f3f4f6",
    "fg-soft": "#e5e7eb",
    "fg-secondary": "#d1d5db",
    "fg-tertiary": "#b4bcc8",
    "fg-muted": "#9ca3af",
    "fg-faint": "#6b7280",
    "fg-disabled": "#4b5563",
    "fg-ghost": "#374151",
    "on-solid": "#ffffff",

    accent: "#60a5fa",
    "accent-strong": "#93c5fd",
    "accent-solid": "#2563eb",
    "accent-solid-hover": "#1d4ed8",
    "accent-muted": "#3b82f6",
    "accent-ring": "#60a5fa",
    "accent-soft": "#16213a",
    "accent-line": "#1e40af",

    danger: "#f87171",
    "danger-strong": "#fca5a5",
    "danger-muted": "#ef4444",
    "danger-soft": "#2a1518",
    "danger-line-soft": "#3b1d21",
    "danger-line": "#5c2328",
    "danger-line-strong": "#b91c1c",
    "danger-solid": "#ef4444",

    success: "#4ade80",
    "success-strong": "#86efac",
    "success-soft": "#10241a",
    gain: "#34d399",

    warning: "#fbbf24",
    "warning-strong": "#fcd34d",
    "warning-muted": "#f59e0b",
    "warning-soft": "#2a2010",
    "warning-line-soft": "#3a2c12",
    "warning-line": "#5c4514",
    "warning-line-strong": "#b45309",

    caution: "#fb923c",
    "caution-muted": "#f97316",
    "caution-soft": "#2b1b10",

    "data-good": "#22c55e",
    "data-caution": "#facc15",
    "data-warn": "#fb923c",
    "data-over": "#ef4444",
    "data-over-deep": "#b91c1c",

    scrim: "#000000",
  },
} as const satisfies Record<ThemeName, Record<string, string>>;

export type ThemeToken = keyof (typeof THEME_TOKENS)["light"];

export const TOKEN_NAMES = Object.keys(THEME_TOKENS.light) as ThemeToken[];

// Category and avatar colours are not themed tokens: a category's colour is a
// Tailwind class name stored in Postgres (`Category.color`, seeded by
// lib/categories.ts and written by the Monarch import), so these exact names
// have to keep resolving for rows that already exist. They are hue swatches
// whose job is to be told apart, which works on either background.
export const CATEGORICAL_PALETTE = {
  amber: { 500: "#f59e0b" },
  blue: { 400: "#60a5fa", 500: "#3b82f6" },
  cyan: { 500: "#06b6d4" },
  emerald: { 400: "#34d399", 500: "#10b981" },
  fuchsia: { 400: "#e879f9", 500: "#d946ef" },
  gray: { 400: "#9ca3af" },
  green: { 500: "#22c55e" },
  indigo: { 400: "#818cf8" },
  lime: { 500: "#84cc16" },
  orange: { 400: "#fb923c", 500: "#f97316" },
  pink: { 400: "#f472b6" },
  red: { 400: "#f87171" },
  rose: { 500: "#f43f5e" },
  sky: { 500: "#0ea5e9" },
  teal: { 400: "#2dd4bf", 500: "#14b8a6" },
  violet: { 500: "#8b5cf6" },
  yellow: { 500: "#eab308" },
} as const;

/** `"#2563eb"` → `"37 99 235"`, the form `rgb(var(--x) / <alpha>)` needs. */
export function hexToChannels(hex: string): string {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(" ");
}

export function tokenVar(token: ThemeToken): string {
  return `--c-${token}`;
}
