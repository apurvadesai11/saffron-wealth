import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";
import {
  CATEGORICAL_PALETTE,
  THEME_TOKENS,
  TOKEN_NAMES,
  hexToChannels,
  tokenVar,
} from "./lib/theme-tokens";

// Every colour utility resolves to a CSS variable, so switching theme swaps
// variable values and no class in the codebase changes.
const tokenColors = Object.fromEntries(
  TOKEN_NAMES.map((t) => [t, `rgb(var(${tokenVar(t)}) / <alpha-value>)`]),
);

const categoricalBackgrounds = Object.entries(CATEGORICAL_PALETTE).flatMap(([hue, steps]) =>
  Object.keys(steps).map((step) => `bg-${hue}-${step}`),
);

function themeVariables(theme: keyof typeof THEME_TOKENS) {
  const values = THEME_TOKENS[theme] as Record<string, string>;
  return Object.fromEntries(
    TOKEN_NAMES.map((t) => [tokenVar(t), hexToChannels(values[t])]),
  );
}

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  // Category.color is a class name stored in Postgres, so it never appears in
  // the files Tailwind scans. Without this, a stored colour only got CSS when
  // some component happened to use the same class, and the rest rendered blank.
  safelist: categoricalBackgrounds,
  theme: {
    // Replaces Tailwind's default palette rather than extending it, so a raw
    // shade like `bg-gray-500` produces no CSS. See lib/theme-tokens.ts.
    colors: {
      transparent: "transparent",
      current: "currentColor",
      inherit: "inherit",
      ...tokenColors,
      ...CATEGORICAL_PALETTE,
    },
    extend: {
      // Preflight gives a bare `border` this colour. It reads
      // theme('colors.gray.200'), which no longer exists.
      borderColor: { DEFAULT: tokenColors.line },
    },
  },
  plugins: [
    plugin(({ addBase }) => {
      // System is the default: no data-theme attribute, and the OS media query
      // decides. app/layout.tsx sets data-theme only for an explicit choice.
      // `color-scheme` makes native controls (date pickers, selects,
      // scrollbars) follow the theme as well.
      const light = { ...themeVariables("light"), colorScheme: "light" };
      const dark = { ...themeVariables("dark"), colorScheme: "dark" };
      addBase({
        ":root": light,
        "@media (prefers-color-scheme: dark)": { ':root:not([data-theme="light"])': dark },
        ':root[data-theme="dark"]': dark,
      });
    }),
  ],
};

export default config;
