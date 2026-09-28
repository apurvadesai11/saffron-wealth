import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth/sessions";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "@/lib/auth/csrf-shared";
import { limitForScope, __resetRateLimiterForTests } from "@/lib/auth/rate-limit";

// Item 7: rateLimit() reached only 4 of 21 routes. These four were uncovered
// and each is expensive — two buffer a multi-megabyte CSV into a 20-30s
// transaction, one runs a sharp re-encode, and change-password runs an Argon2
// verify against the CURRENT password, making it a password oracle for anyone
// holding a stolen session.
//
// The limit check sits immediately after the CSRF check and before any body
// parsing, so these can assert the 429 without constructing real CSVs or
// images: past the limit the route must refuse before it looks at the body.

const mocks = vi.hoisted(() => ({ sessionToken: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      (name === "sw_session" || name === "__Host-sw_session") && mocks.sessionToken
        ? { value: mocks.sessionToken }
        : undefined,
  }),
}));

import { POST as CHANGE_PASSWORD } from "../../profile/change-password/route";
import { POST as PICTURE } from "../../profile/picture/route";
import { POST as TXN_IMPORT } from "../../transactions/import/route";
import { POST as BALANCE_IMPORT } from "../../accounts/balance-history/route";

const CSRF = "route-rl-csrf";
const createdUsers: string[] = [];

async function seedAuthed() {
  const email = `rl-${randomUUID()}@example.test`;
  const user = await prisma.user.create({
    data: { email, emailNormalized: email.toLowerCase(), firstName: "R", lastName: "L" },
  });
  createdUsers.push(user.id);
  const { rawToken } = await createSession(user.id, "vitest", "127.0.0.1");
  mocks.sessionToken = rawToken;
  return user;
}

function post(url: string) {
  const headers = new Headers({
    "content-type": "application/json",
    [CSRF_HEADER_NAME]: CSRF,
  });
  const req = new NextRequest(url, { method: "POST", headers, body: "{}" });
  req.cookies.set(CSRF_COOKIE_NAME, CSRF);
  return req;
}

type Handler = (req: NextRequest) => Promise<Response>;

/**
 * Calls `handler` until it returns 429, up to `limit + 1` times.
 *
 * Returns the last status and how many calls were admitted before refusal, so
 * a test can assert both that the limit exists and that it is the right one.
 */
async function exhaust(handler: Handler, url: string, limit: number) {
  let admitted = 0;
  let last: Response | null = null;
  for (let i = 0; i < limit + 1; i++) {
    last = await handler(post(url));
    if (last.status === 429) break;
    admitted++;
  }
  return { admitted, last: last! };
}

beforeEach(() => {
  mocks.sessionToken = null;
  __resetRateLimiterForTests();
});

afterEach(async () => {
  for (const id of createdUsers) {
    await prisma.user.delete({ where: { id } }).catch(() => {});
  }
  createdUsers.length = 0;
});

describe("POST /api/profile/change-password rate limit", () => {
  it("returns 429 RATE_LIMITED past its limit", async () => {
    await seedAuthed();
    const { limit } = limitForScope("change-password");

    const { admitted, last } = await exhaust(
      CHANGE_PASSWORD,
      "http://localhost/api/profile/change-password",
      limit,
    );

    expect(admitted).toBe(limit);
    expect(last.status).toBe(429);
    expect((await last.json()).error.code).toBe("RATE_LIMITED");
  }, 60_000);

  it("charges the limit to the user, not the IP", async () => {
    // Two users from the same (absent) IP must not share a bucket — and a
    // second user must be unaffected by the first exhausting theirs.
    await seedAuthed();
    const { limit } = limitForScope("change-password");
    await exhaust(CHANGE_PASSWORD, "http://localhost/api/profile/change-password", limit);

    const before = await CHANGE_PASSWORD(post("http://localhost/api/profile/change-password"));
    expect(before.status).toBe(429);

    await seedAuthed(); // different user id, same request shape
    const after = await CHANGE_PASSWORD(post("http://localhost/api/profile/change-password"));
    expect(after.status).not.toBe(429);
  }, 60_000);
});

describe("POST /api/profile/picture rate limit", () => {
  it("returns 429 RATE_LIMITED past its limit", async () => {
    await seedAuthed();
    const { limit } = limitForScope("picture");

    const { admitted, last } = await exhaust(
      PICTURE,
      "http://localhost/api/profile/picture",
      limit,
    );

    expect(admitted).toBe(limit);
    expect(last.status).toBe(429);
    expect((await last.json()).error.code).toBe("RATE_LIMITED");
  }, 60_000);
});

describe("POST /api/transactions/import rate limit", () => {
  it("returns 429 RATE_LIMITED past its limit", async () => {
    await seedAuthed();
    const { limit } = limitForScope("import");

    const { admitted, last } = await exhaust(
      TXN_IMPORT,
      "http://localhost/api/transactions/import",
      limit,
    );

    expect(admitted).toBe(limit);
    expect(last.status).toBe(429);
    expect((await last.json()).error.code).toBe("RATE_LIMITED");
  }, 60_000);

  it("does not throttle a preview-then-commit round trip", async () => {
    // The legitimate flow is two requests. Four, allowing a retry of each,
    // must still be admitted.
    await seedAuthed();
    for (let i = 0; i < 4; i++) {
      const res = await TXN_IMPORT(post("http://localhost/api/transactions/import"));
      expect(res.status).not.toBe(429);
    }
  }, 60_000);
});

describe("POST /api/accounts/balance-history rate limit", () => {
  it("returns 429 RATE_LIMITED past its limit", async () => {
    await seedAuthed();
    const { limit } = limitForScope("import");

    const { admitted, last } = await exhaust(
      BALANCE_IMPORT,
      "http://localhost/api/accounts/balance-history",
      limit,
    );

    expect(admitted).toBe(limit);
    expect(last.status).toBe(429);
    expect((await last.json()).error.code).toBe("RATE_LIMITED");
  }, 60_000);
});

describe("rate limits are charged after authentication", () => {
  it("an unauthenticated request is rejected without consuming the bucket", async () => {
    // Otherwise an anonymous caller could exhaust a known user's allowance,
    // turning the limit into a denial-of-service tool.
    mocks.sessionToken = null;
    for (let i = 0; i < 20; i++) {
      const res = await CHANGE_PASSWORD(post("http://localhost/api/profile/change-password"));
      expect(res.status).toBe(401);
    }

    await seedAuthed();
    const res = await CHANGE_PASSWORD(post("http://localhost/api/profile/change-password"));
    expect(res.status).not.toBe(429);
  }, 60_000);
});
