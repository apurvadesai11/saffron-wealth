import { createHash } from "node:crypto";

// Pwned Passwords k-anonymity API.
// We send only the first 5 chars of SHA-1(password) and receive a list of
// suffix:count pairs to compare locally — the plaintext (and full hash) never
// leaves this process.
const ENDPOINT = "https://api.pwnedpasswords.com/range/";
const TIMEOUT_MS = 5000;

export interface HibpResult {
  pwned: boolean;
  /** Defined when the API call failed; we fail open and let the caller decide
   *  whether to surface the unavailability to the user (we don't). */
  unavailable?: boolean;
}

function sha1Upper(input: string): string {
  return createHash("sha1").update(input).digest("hex").toUpperCase();
}

// Tiny LRU-ish cache keyed by SHA-1 prefix only (5 chars). We never cache the
// plaintext, the full hash, or any suffix — only the prefix's response body.
const responseCache = new Map<string, string>();
const CACHE_LIMIT = 1000;

async function fetchRange(prefix: string): Promise<string | null> {
  const cached = responseCache.get(prefix);
  if (cached !== undefined) return cached;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${ENDPOINT}${prefix}`, {
      method: "GET",
      headers: { "Add-Padding": "true" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (responseCache.size >= CACHE_LIMIT) {
      const firstKey = responseCache.keys().next().value;
      if (firstKey !== undefined) responseCache.delete(firstKey);
    }
    responseCache.set(prefix, text);
    return text;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkPwnedPassword(plain: string): Promise<HibpResult> {
  const fullHash = sha1Upper(plain);
  const prefix = fullHash.slice(0, 5);
  const suffix = fullHash.slice(5);

  const body = await fetchRange(prefix);
  if (body === null) {
    return { pwned: false, unavailable: true };
  }

  // Each line is "SUFFIX:COUNT" (count > 0 if seen in any breach).
  for (const line of body.split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const candidate = line.slice(0, colon).trim();
    if (candidate === suffix) {
      return { pwned: true };
    }
  }
  return { pwned: false };
}
