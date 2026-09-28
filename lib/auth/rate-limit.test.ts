import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  rateLimit,
  limitForScope,
  __resetRateLimiterForTests,
} from "./rate-limit";

// These exercise the in-memory fallback. Upstash is not configured in tests
// (no UPSTASH_* env vars), which is the path dev and CI actually take.

beforeEach(() => {
  __resetRateLimiterForTests();
});

afterEach(() => {
  vi.useRealTimers();
  __resetRateLimiterForTests();
});

async function drain(scope: string, id: string, times: number) {
  const results = [];
  for (let i = 0; i < times; i++) results.push(await rateLimit(scope, id));
  return results;
}

describe("limitForScope", () => {
  it("gives the expensive authenticated scopes longer windows", () => {
    // change-password runs an Argon2 verify against the current password, so
    // its window is 15 minutes rather than one.
    expect(limitForScope("change-password")).toEqual({ limit: 5, windowMs: 900_000 });
    expect(limitForScope("import")).toEqual({ limit: 10, windowMs: 600_000 });
    expect(limitForScope("picture")).toEqual({ limit: 10, windowMs: 600_000 });
  });

  it("keeps the pre-auth scopes at 5 per minute", () => {
    expect(limitForScope("login")).toEqual({ limit: 5, windowMs: 60_000 });
    expect(limitForScope("register")).toEqual({ limit: 5, windowMs: 60_000 });
  });

  it("gives password-reset request and confirm separate buckets", () => {
    // They shared one scope, so five combined requests exhausted both halves
    // of the flow — a user could be locked out of confirming by their own
    // requests.
    expect(limitForScope("password-reset-request")).toBeDefined();
    expect(limitForScope("password-reset-confirm")).toBeDefined();
  });

  it("falls back to a conservative default for an unknown scope", () => {
    // An unrecognized scope is a programming error, not a request to be
    // unlimited.
    expect(limitForScope("no-such-scope")).toEqual({ limit: 5, windowMs: 60_000 });
  });
});

describe("rateLimit", () => {
  it("allows exactly `limit` requests and refuses the next", async () => {
    const results = await drain("login", "1.2.3.4", 6);
    expect(results.slice(0, 5).every(r => r.ok)).toBe(true);
    expect(results[5].ok).toBe(false);
  });

  it("counts down `remaining`", async () => {
    const results = await drain("login", "remaining-probe", 5);
    expect(results.map(r => r.remaining)).toEqual([4, 3, 2, 1, 0]);
  });

  it("keeps separate buckets per identifier", async () => {
    await drain("login", "ip-a", 5);
    expect((await rateLimit("login", "ip-a")).ok).toBe(false);
    // A different caller must be unaffected.
    expect((await rateLimit("login", "ip-b")).ok).toBe(true);
  });

  it("keeps separate buckets per scope", async () => {
    await drain("login", "same-id", 5);
    expect((await rateLimit("login", "same-id")).ok).toBe(false);
    // Same identifier, different scope: its own allowance.
    expect((await rateLimit("register", "same-id")).ok).toBe(true);
  });

  it("does not let password-reset request exhaust confirm", async () => {
    await drain("password-reset-request", "1.2.3.4", 6);
    expect((await rateLimit("password-reset-request", "1.2.3.4")).ok).toBe(false);
    expect((await rateLimit("password-reset-confirm", "1.2.3.4")).ok).toBe(true);
  });

  it("applies the import scope's higher ceiling", async () => {
    const results = await drain("import", "user-1", 11);
    expect(results.slice(0, 10).every(r => r.ok)).toBe(true);
    expect(results[10].ok).toBe(false);
  });

  it("does not throttle a legitimate preview-then-commit import", async () => {
    // The real flow is two requests per import, and a user may reasonably
    // import transactions and balance history in one sitting, with a retry.
    const results = await drain("import", "user-2", 6);
    expect(results.every(r => r.ok)).toBe(true);
  });

  it("holds change-password to 5 within its 15-minute window", async () => {
    const results = await drain("change-password", "user-3", 6);
    expect(results.slice(0, 5).every(r => r.ok)).toBe(true);
    expect(results[5].ok).toBe(false);
  });
});

describe("rateLimit window expiry", () => {
  it("lets requests through again once the window slides past", async () => {
    // Fake only Date so the limiter's cutoff arithmetic moves without
    // deadlocking anything that awaits a real timer.
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = new Date("2026-03-01T12:00:00.000Z");
    vi.setSystemTime(start);

    await drain("login", "expiry-probe", 5);
    expect((await rateLimit("login", "expiry-probe")).ok).toBe(false);

    // Still inside the 60s window.
    vi.setSystemTime(new Date(start.getTime() + 59_000));
    expect((await rateLimit("login", "expiry-probe")).ok).toBe(false);

    // Past it.
    vi.setSystemTime(new Date(start.getTime() + 61_000));
    expect((await rateLimit("login", "expiry-probe")).ok).toBe(true);
  });

  it("respects the longer change-password window", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = new Date("2026-03-01T12:00:00.000Z");
    vi.setSystemTime(start);

    await drain("change-password", "slow-probe", 5);
    expect((await rateLimit("change-password", "slow-probe")).ok).toBe(false);

    // A minute later a login bucket would have reset; this one must not.
    vi.setSystemTime(new Date(start.getTime() + 61_000));
    expect((await rateLimit("change-password", "slow-probe")).ok).toBe(false);

    vi.setSystemTime(new Date(start.getTime() + 901_000));
    expect((await rateLimit("change-password", "slow-probe")).ok).toBe(true);
  });
});

describe("limiter memoization", () => {
  it("reuses one limiter per scope so history is not discarded", async () => {
    // Rebuilding the limiter per request would reset the hit history that IS
    // the rate limit, making it silently ineffective.
    await drain("login", "memo-probe", 5);
    expect((await rateLimit("login", "memo-probe")).ok).toBe(false);
    // A further call must still see the exhausted bucket.
    expect((await rateLimit("login", "memo-probe")).ok).toBe(false);
  });

  it("starts clean after an explicit test reset", async () => {
    await drain("login", "reset-probe", 6);
    expect((await rateLimit("login", "reset-probe")).ok).toBe(false);
    __resetRateLimiterForTests();
    expect((await rateLimit("login", "reset-probe")).ok).toBe(true);
  });
});
