#!/usr/bin/env node
// Fails if the environment variables the source actually reads and the ones
// .env.example documents have drifted apart.
//
// This existed as a one-time grep in an audit finding. It is a script because
// the drift it catches is silent and total: the code read GOOGLE_CLIENT_ID
// while .env.example documented GOOGLE_OAUTH_CLIENT_ID, so following the setup
// instructions produced a Google sign-in button that could never work, and
// GOOGLE_OAUTH_REDIRECT_URI sat documented but unread. Nothing failed — it
// just didn't work.
//
// Usage:  node scripts/check-env-parity.mjs   (or `npm run check:env`)

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SCAN_ROOTS = ["app", "components", "lib", "scripts", "proxy.ts", "middleware.ts"];
const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".mjs", ".js", ".jsx"]);

// This checker names variables in prose and in its own exception list, so
// scanning it would report its own examples as real reads.
const SELF = "check-env-parity.mjs";

// Read by something other than application source, so absence from the grep is
// expected rather than drift.
const DOCUMENTED_BUT_NOT_IN_SOURCE = new Map([
  ["DATABASE_URL", "read by Prisma via schema.prisma's env() binding, not process.env"],
]);

// Supplied by the runtime, never something you put in .env.
const RUNTIME_PROVIDED = new Set(["NODE_ENV"]);

function walk(path, out = []) {
  const stats = statSync(path);
  if (stats.isFile()) {
    if (SCAN_EXTENSIONS.has(extname(path)) && !path.endsWith(SELF)) out.push(path);
    return out;
  }
  for (const entry of readdirSync(path)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    walk(join(path, entry), out);
  }
  return out;
}

const files = SCAN_ROOTS.flatMap(root => {
  const abs = join(repoRoot, root);
  try {
    return walk(abs);
  } catch {
    return []; // an optional root (middleware.ts) may not exist
  }
});

const readInSource = new Map(); // var name -> Set of repo-relative files
for (const file of files) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/process\.env\.([A-Z_0-9]+)/g)) {
    const name = match[1];
    if (RUNTIME_PROVIDED.has(name)) continue;
    if (!readInSource.has(name)) readInSource.set(name, new Set());
    readInSource.get(name).add(file.slice(repoRoot.length + 1));
  }
}

const example = readFileSync(join(repoRoot, ".env.example"), "utf8");
const documented = new Set(
  example
    .split("\n")
    .map(line => /^([A-Z_0-9]+)=/.exec(line.trim())?.[1])
    .filter(Boolean),
);

const undocumented = [...readInSource.keys()].filter(n => !documented.has(n)).sort();
const unread = [...documented]
  .filter(n => !readInSource.has(n) && !DOCUMENTED_BUT_NOT_IN_SOURCE.has(n))
  .sort();

if (undocumented.length === 0 && unread.length === 0) {
  const counted = readInSource.size + DOCUMENTED_BUT_NOT_IN_SOURCE.size;
  console.log(`check:env — ok, ${counted} variables agree between source and .env.example`);
  process.exit(0);
}

console.error("check:env — source and .env.example disagree\n");
for (const name of undocumented) {
  const where = [...readInSource.get(name)].sort().join(", ");
  console.error(`  read but NOT documented: ${name}`);
  console.error(`    read in: ${where}`);
  console.error(`    fix: add ${name} to .env.example, or stop reading it\n`);
}
for (const name of unread) {
  console.error(`  documented but NEVER read: ${name}`);
  console.error(`    fix: read it, or delete it from .env.example — dead config is worse`);
  console.error(`         than missing config, because it reads as configured\n`);
}
process.exit(1);
