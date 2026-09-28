import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "@/lib/auth/csrf-shared";
import { __resetRateLimiterForTests, limitForScope } from "@/lib/auth/rate-limit";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

import { POST as LOGIN } from "../login/route";

// Item 10, at the level the defect actually mattered: clientIp took the
// LEFT-most X-Forwarded-For entry, which is whatever the client claimed. Every
// IP-keyed rate limit was therefore bypassable by rotating a header value.
//
// Each request below uses a DIFFERENT unknown email so the per-account
// exponential backoff cannot be what produces a 429 — the only thing that can
// throttle these is the IP bucket.

const CSRF = "spoof-test-csrf";

function loginWith(headers: Record<string, string>) {
  const h = new Headers({
    "content-type": "application/json",
    [CSRF_HEADER_NAME]: CSRF,
    ...headers,
  });
  const req = new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    headers: h,
    body: JSON.stringify({
      email: `unknown-${randomUUID()}@example.test`,
      password: "not-the-password",
    }),
  });
  req.cookies.set(CSRF_COOKIE_NAME, CSRF);
  return req;
}

beforeEach(() => {
  __resetRateLimiterForTests();
});

describe("IP rate limiting cannot be bypassed by rotating X-Forwarded-For", () => {
  it("throttles past the limit even when the claimed left-most entry changes", async () => {
    const { limit } = limitForScope("login");
    const statuses: number[] = [];

    for (let i = 0; i < limit + 1; i++) {
      // Left-most rotates on every request; the right-most is what the proxy
      // observed and is the same caller throughout.
      const res = await LOGIN(
        loginWith({ "x-forwarded-for": `10.0.0.${i}, 198.51.100.9` }),
      );
      statuses.push(res.status);
    }

    // Reading the left-most entry gave every request its own bucket, so all of
    // these used to be admitted.
    expect(statuses.filter(s => s === 429).length).toBeGreaterThan(0);
    expect(statuses[statuses.length - 1]).toBe(429);
  }, 120_000);

  it("keys off the platform header when present, ignoring a spoofed chain", async () => {
    const { limit } = limitForScope("login");
    const statuses: number[] = [];

    for (let i = 0; i < limit + 1; i++) {
      const res = await LOGIN(
        loginWith({
          "x-vercel-forwarded-for": "203.0.113.50",
          "x-forwarded-for": `172.16.0.${i}`,
        }),
      );
      statuses.push(res.status);
    }

    expect(statuses[statuses.length - 1]).toBe(429);
  }, 120_000);

  it("still separates genuinely different callers", async () => {
    // The fix must not collapse distinct callers into one bucket, which would
    // let one client throttle everyone else.
    const { limit } = limitForScope("login");

    for (let i = 0; i < limit + 1; i++) {
      await LOGIN(loginWith({ "x-forwarded-for": "1.1.1.1, 198.51.100.9" }));
    }
    const exhausted = await LOGIN(
      loginWith({ "x-forwarded-for": "1.1.1.1, 198.51.100.9" }),
    );
    expect(exhausted.status).toBe(429);

    // A different observed address must still be served.
    const other = await LOGIN(
      loginWith({ "x-forwarded-for": "1.1.1.1, 203.0.113.77" }),
    );
    expect(other.status).not.toBe(429);
  }, 120_000);
});
