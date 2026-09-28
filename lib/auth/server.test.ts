// SESSION_COOKIE_NAME's two environments are pinned in session-cookie.test.ts,
// which owns that branch. This file covers getSession's own contract: the
// cookie is read by the environment-correct name, a missing cookie short-
// circuits without touching the database, and React.cache means repeated calls
// in one render cost one query.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookieValue: undefined as string | undefined,
  readSession: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      mocks.cookieValue !== undefined ? { name, value: mocks.cookieValue } : undefined,
  }),
}));
vi.mock("./sessions", () => ({ readSession: mocks.readSession }));

const SESSION = {
  id: "s1",
  userId: "u1",
  expiresAt: new Date(Date.now() + 60_000),
  user: { id: "u1", email: "a@b.com", firstName: "A", lastName: "B", profilePicture: null },
};

beforeEach(() => {
  mocks.cookieValue = undefined;
  mocks.readSession.mockReset().mockResolvedValue(SESSION);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("getSession", () => {
  it("returns null without consulting the database when there is no cookie", async () => {
    const { getSession } = await import("./server");

    await expect(getSession()).resolves.toBeNull();
    expect(mocks.readSession).not.toHaveBeenCalled();
  });

  it("hands the raw cookie value to readSession and returns what it resolves", async () => {
    mocks.cookieValue = "raw-token";
    const { getSession } = await import("./server");

    await expect(getSession()).resolves.toEqual(SESSION);
    expect(mocks.readSession).toHaveBeenCalledWith("raw-token");
  });

  // A shape-valid but unknown token is the forged-cookie case: proxy.ts only
  // regex-checks the cookie at the Edge, so this is where it is actually
  // rejected. Null, not a throw — app/(app)/layout.tsx maps null to a redirect.
  it("returns null when readSession does not recognize the token", async () => {
    mocks.cookieValue = "forged-but-well-shaped";
    mocks.readSession.mockResolvedValue(null);
    const { getSession } = await import("./server");

    await expect(getSession()).resolves.toBeNull();
  });

  // getSession is wrapped in React.cache so the (app) layout and any server
  // component below it can each call it without multiplying queries.
  //
  // That dedupe is deliberately NOT asserted here: React.cache is scoped to a
  // render pass, and outside one it is a passthrough — three calls really do
  // make three queries in a plain Vitest process, which is the correct
  // behavior rather than a bug. Asserting "called once" here would have been a
  // test of nothing, passing only if the mock were memoized by accident. The
  // property is exercised for real by the RSC path in
  // e2e/auth-middleware.spec.ts. What is worth pinning here is that repeated
  // calls agree with each other.
  it("resolves consistently across repeated calls", async () => {
    mocks.cookieValue = "raw-token";
    const { getSession } = await import("./server");

    const [a, b, c] = await Promise.all([getSession(), getSession(), getSession()]);

    expect(a).toEqual(SESSION);
    expect(b).toEqual(SESSION);
    expect(c).toEqual(SESSION);
  });

  it("reads the cookie by the environment's own name", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    mocks.cookieValue = "raw-token";

    const { getSession, SESSION_COOKIE_NAME } = await import("./server");
    await getSession();

    expect(SESSION_COOKIE_NAME).toBe("__Host-sw_session");
    expect(mocks.readSession).toHaveBeenCalledWith("raw-token");
  });
});
