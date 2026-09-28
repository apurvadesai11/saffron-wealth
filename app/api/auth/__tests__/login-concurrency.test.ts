import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getDummyHash } from "@/lib/auth/password";
import { __resetRateLimiterForTests } from "@/lib/auth/rate-limit";

// getSession is not involved in login, but other modules in the import graph
// reach for next/headers; mock it so the route can be called directly.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

import { POST } from "../login/route";
import { makeRequest, cleanupUser } from "./helpers";
import { hashPassword } from "@/lib/auth/password";

const PASSWORD = "correct-horse-battery-1";
const CSRF = "login-test-csrf-token";
const createdUsers: string[] = [];

async function seedPasswordUser() {
  const email = `login-conc-${randomUUID()}@example.test`;
  const user = await prisma.user.create({
    data: {
      email,
      emailNormalized: email.toLowerCase(),
      firstName: "Login",
      lastName: "Probe",
      passwordHash: await hashPassword(PASSWORD),
    },
  });
  createdUsers.push(user.id);
  return user;
}

function loginRequest(email: string, password: string) {
  return makeRequest({
    method: "POST",
    url: "http://localhost/api/auth/login",
    body: { email, password },
    csrfToken: CSRF,
  });
}

beforeAll(async () => {
  // getDummyHash caches a promise at module scope, so the first caller pays the
  // full Argon2 cost. Warm it here or the timing comparison below is noise.
  await getDummyHash();
}, 60_000);

beforeEach(() => {
  __resetRateLimiterForTests();
});

afterEach(async () => {
  for (const id of createdUsers) await cleanupUser(id);
  createdUsers.length = 0;
  await prisma.authEvent.deleteMany({ where: { userId: null } }).catch(() => {});
});

describe("login backoff concurrency invariant", () => {
  // The invariant: two concurrent attempts on the same email cannot BOTH read
  // "OK to attempt". One serializes behind the advisory lock, sees the other's
  // FailedLogin row, and is refused.
  //
  // The assertion direction is counterintuitive. delayForFailureCount indexes
  // DELAY_TABLE_SECONDS by failure count, and index 0 is only reachable via the
  // `failures <= 0` guard — so ONE recorded failure already means a 1-second
  // delay. The second request therefore returns 429 through the backoff branch,
  // which records an audit event but NO FailedLogin row.
  //
  // So: [401, 429] with one row means the lock held. [401, 401] with two rows
  // means both read the counter as 0 before either wrote — a bypass.
  it("refuses the second of two concurrent wrong-password attempts", async () => {
    const user = await seedPasswordUser();

    const [a, b] = await Promise.all([
      POST(loginRequest(user.email, "wrong-one")),
      POST(loginRequest(user.email, "wrong-two")),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([401, 429]);

    const rows = await prisma.failedLogin.count({
      where: { emailNormalized: user.emailNormalized },
    });
    expect(rows).toBe(1);
  }, 30_000);

  it("refuses all but the first of five concurrent attempts", async () => {
    // Same invariant under more pressure: exactly one attempt may be evaluated
    // before the backoff window closes.
    const user = await seedPasswordUser();

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        POST(loginRequest(user.email, `wrong-${i}`)),
      ),
    );

    const unauthorized = results.filter(r => r.status === 401).length;
    const throttled = results.filter(r => r.status === 429).length;
    expect(unauthorized).toBe(1);
    expect(throttled).toBe(4);

    const rows = await prisma.failedLogin.count({
      where: { emailNormalized: user.emailNormalized },
    });
    expect(rows).toBe(1);
  }, 60_000);

  it("does not leak the backoff across different emails", async () => {
    const a = await seedPasswordUser();
    const b = await seedPasswordUser();

    const [ra, rb] = await Promise.all([
      POST(loginRequest(a.email, "wrong")),
      POST(loginRequest(b.email, "wrong")),
    ]);

    // The lock is keyed per email, so these must not serialize against each
    // other — both are first attempts and both should be evaluated.
    expect(ra.status).toBe(401);
    expect(rb.status).toBe(401);
    expect(
      await prisma.failedLogin.count({ where: { emailNormalized: a.emailNormalized } }),
    ).toBe(1);
    expect(
      await prisma.failedLogin.count({ where: { emailNormalized: b.emailNormalized } }),
    ).toBe(1);
  }, 30_000);

  it("clears the failure rows on a successful login", async () => {
    const user = await seedPasswordUser();

    const bad = await POST(loginRequest(user.email, "wrong"));
    expect(bad.status).toBe(401);
    expect(
      await prisma.failedLogin.count({ where: { userId: user.id } }),
    ).toBe(1);

    // Wait out the 1-second backoff the single failure created.
    await new Promise(r => setTimeout(r, 1200));

    const good = await POST(loginRequest(user.email, PASSWORD));
    expect(good.status).toBe(200);
    expect(good.headers.get("set-cookie") ?? "").toMatch(/sw_session=/);
    expect(
      await prisma.failedLogin.count({ where: { userId: user.id } }),
    ).toBe(0);
  }, 30_000);
});

describe("login timing uniformity", () => {
  // The dummy-hash path exists so an unknown email costs the same as a known
  // one with a wrong password. If it regresses, response time enumerates
  // accounts.
  it("takes comparable time for a wrong password and an unknown email", async () => {
    const user = await seedPasswordUser();

    async function timeOnce(email: string, password: string): Promise<number> {
      __resetRateLimiterForTests();
      // Clear failure rows so neither call short-circuits through backoff,
      // which would skip the hash entirely and make the comparison meaningless.
      await prisma.failedLogin.deleteMany({ where: { emailNormalized: email.toLowerCase() } });
      const started = performance.now();
      await POST(loginRequest(email, password));
      return performance.now() - started;
    }

    const samples = 3;
    const known: number[] = [];
    const unknown: number[] = [];
    for (let i = 0; i < samples; i++) {
      known.push(await timeOnce(user.email, "wrong-password"));
      unknown.push(await timeOnce(`nobody-${randomUUID()}@example.test`, "wrong-password"));
    }

    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const mKnown = median(known);
    const mUnknown = median(unknown);
    const ratio = Math.max(mKnown, mUnknown) / Math.min(mKnown, mUnknown);

    // Both paths run one Argon2 verify, so they should be within the same
    // order of magnitude. A generous bound: this is a real-DB integration test
    // and the point is to catch the dummy-hash path being removed entirely,
    // not to measure microseconds.
    expect(ratio, `known=${mKnown.toFixed(1)}ms unknown=${mUnknown.toFixed(1)}ms`).toBeLessThan(3);
  }, 120_000);
});
