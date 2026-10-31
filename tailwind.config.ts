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
  // Category.color is stored in Postgres; until tokens, this class was only
  // generated because BudgetProgressBar happened to use it too.
  safelist: ["bg-orange-400"],
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
      addBase({ ":root": themeVariables("light") });
    }),
  ],
};

export default config;
