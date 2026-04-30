import { COMMON_PASSWORDS_RAW } from "./blocklist-data";

// Lower-case-normalized Set built once at module load.
const BLOCKLIST: Set<string> = new Set(
  COMMON_PASSWORDS_RAW.map((p) => p.toLowerCase()),
);

export function isCommonPassword(plain: string): boolean {
  return BLOCKLIST.has(plain.toLowerCase());
}

// Exposed for tests and debug only.
export function blocklistSize(): number {
  return BLOCKLIST.size;
}
