import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { TOKEN_NAMES } from "@/lib/theme-tokens";

// tailwind.config.ts replaces the default palette, so `bg-gray-500` already
// produces no CSS. That is enforcement with a silent failure mode: an unknown
// class renders unstyled rather than breaking the build. This test is the loud
// half — it catches a raw shade, an arbitrary colour, an inline colour style,
// or a misspelled token before it ships looking wrong in one of the themes.

const ROOT = process.cwd();

// Raw hues a file may use, as a class pattern rather than the whole file — an
// earlier whole-file entry let a stray `text-white` through. Each must say why.
const RAW_HUE_ALLOWLIST: Record<string, RegExp> = {
  // Avatar initials pick a background from a fixed hue set by hashing the
  // name; the hues are identity swatches, not themed surfaces.
  "components/auth/AvatarFallback.tsx": /^bg-[a-z]+-500$/,
};

const PREFIX = "(?:bg|text|border(?:-[trblxy])?|divide|ring(?:-offset)?|fill|stroke|from|via|to|placeholder|outline|decoration|caret|accent|shadow)";
const HUE = "(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)";

const RAW_HUE = new RegExp(`(?<![\\w-])${PREFIX}-${HUE}(?:-\\d{2,3})?(?:/\\d+)?(?![\\w-])`, "g");
const ARBITRARY_COLOR = new RegExp(`(?<![\\w-])${PREFIX}-\\[(?:#|rgb|hsl)`, "g");
const INLINE_COLOR_STYLE = /style=\{\{[^}]*\b(?:color|background(?:Color)?|borderColor|fill|stroke)\s*:/g;

// A class that starts like a token family must be a real token.
const TOKEN_FAMILY = "(?:canvas|surface|inverse|line|fg|on|accent|danger|success|gain|warning|caution|data|scrim)";
const TOKEN_LIKE = new RegExp(`(?<![\\w-])(?:bg|text|border(?:-[trblxy])?|divide|ring|fill|stroke)-(${TOKEN_FAMILY}(?:-[a-z]+)*)(?:/\\d+)?(?![\\w-])`, "g");
const TOKENS = new Set<string>(TOKEN_NAMES);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(path);
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [path] : [];
  });
}

const FILES = [...sourceFiles(join(ROOT, "app")), ...sourceFiles(join(ROOT, "components"))].map(
  (abs) => ({ rel: relative(ROOT, abs), src: readFileSync(abs, "utf8") }),
);

function matches(re: RegExp, src: string): string[] {
  return [...src.matchAll(re)].map((m) => m[0]);
}

describe("colours go through theme tokens", () => {
  it("finds the source files it is meant to scan", () => {
    expect(FILES.length).toBeGreaterThan(30);
  });

  it("no raw Tailwind hue classes outside the allowlist", () => {
    const offenders = FILES.flatMap((f) =>
      matches(RAW_HUE, f.src)
        .filter((cls) => !RAW_HUE_ALLOWLIST[f.rel]?.test(cls))
        .map((cls) => `${f.rel}: ${cls}`),
    );
    expect(offenders).toEqual([]);
  });

  it("no arbitrary colour values or inline colour styles", () => {
    const offenders = FILES.flatMap((f) =>
      [...matches(ARBITRARY_COLOR, f.src), ...matches(INLINE_COLOR_STYLE, f.src)].map(
        (hit) => `${f.rel}: ${hit}`,
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("every token-shaped class names a real token", () => {
    const offenders = FILES.flatMap((f) =>
      [...f.src.matchAll(TOKEN_LIKE)]
        .filter((m) => !TOKENS.has(m[1]))
        .map((m) => `${f.rel}: ${m[0]}`),
    );
    expect(offenders).toEqual([]);
  });
});
