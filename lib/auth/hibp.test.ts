import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { checkPwnedPassword } from "./hibp";

const KNOWN_PWNED = "password";
const KNOWN_PWNED_SHA1 = createHash("sha1")
  .update(KNOWN_PWNED)
  .digest("hex")
  .toUpperCase();
const KNOWN_PREFIX = KNOWN_PWNED_SHA1.slice(0, 5);
const KNOWN_SUFFIX = KNOWN_PWNED_SHA1.slice(5);

const STRONG = "k7@vQpL!9zXrM2nW";
const STRONG_SHA1 = createHash("sha1").update(STRONG).digest("hex").toUpperCase();
const STRONG_SUFFIX = STRONG_SHA1.slice(5);

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
});

describe("checkPwnedPassword", () => {
  it("flags a password whose suffix is in the API response", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(`${KNOWN_SUFFIX}:1234\nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1:5`),
    ) as unknown as typeof fetch;
    const result = await checkPwnedPassword(KNOWN_PWNED);
    expect(result.pwned).toBe(true);
    expect(result.unavailable).toBeUndefined();
  });

  it("does not flag a password whose suffix is absent", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1:5\nBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB2:99"),
    ) as unknown as typeof fetch;
    const result = await checkPwnedPassword(STRONG);
    expect(result.pwned).toBe(false);
    expect(STRONG_SUFFIX.length).toBeGreaterThan(0);
  });

  it("fails open (returns unavailable, not pwned) when API returns 500", async () => {
    globalThis.fetch = vi.fn(async () => new Response("server error", { status: 500 })) as unknown as typeof fetch;
    const result = await checkPwnedPassword("anything-else");
    expect(result.pwned).toBe(false);
    expect(result.unavailable).toBe(true);
  });

  it("fails open when fetch throws (network error or abort)", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ETIMEDOUT");
    }) as unknown as typeof fetch;
    const result = await checkPwnedPassword("another-password-string");
    expect(result.pwned).toBe(false);
    expect(result.unavailable).toBe(true);
  });

  it("sends only the 5-char prefix of the SHA-1 hash, never the plaintext or full hash", async () => {
    const fetchSpy = vi.fn(async () => new Response("")) as unknown as typeof fetch;
    globalThis.fetch = fetchSpy;
    await checkPwnedPassword("tracked-password-123");
    const calledUrl = (fetchSpy as unknown as { mock: { calls: [string][] } }).mock
      .calls[0][0];
    expect(calledUrl.endsWith(KNOWN_PREFIX) || /\/[0-9A-F]{5}$/.test(calledUrl)).toBe(
      true,
    );
    expect(calledUrl).not.toContain("tracked-password-123");
    expect(calledUrl).not.toContain(
      createHash("sha1").update("tracked-password-123").digest("hex").toUpperCase(),
    );
  });
});
