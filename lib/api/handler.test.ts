import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// The three gates are the whole point of the wrapper, so they're mocked here
// and exercised for real in the route integration tests against Postgres.
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  validateCsrfFromRequest: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/auth/csrf", () => ({
  validateCsrfFromRequest: mocks.validateCsrfFromRequest,
}));
vi.mock("@/lib/auth/rate-limit", () => ({ rateLimit: mocks.rateLimit }));

const { withApiHandler } = await import("./handler");

const SESSION = {
  id: "s1",
  userId: "u1",
  expiresAt: new Date(Date.now() + 60_000),
  user: {
    id: "u1",
    email: "a@b.com",
    firstName: "A",
    lastName: "B",
    profilePicture: null,
  },
};

function req() {
  return new NextRequest("http://localhost/api/thing", { method: "POST" });
}

beforeEach(() => {
  mocks.getSession.mockReset().mockResolvedValue(SESSION);
  mocks.validateCsrfFromRequest.mockReset().mockReturnValue(true);
  mocks.rateLimit.mockReset().mockResolvedValue({ ok: true });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("withApiHandler", () => {
  it("passes the session and request through to the handler", async () => {
    const handler = withApiHandler({ logLabel: "api/thing" }, async (ctx) =>
      NextResponse.json({ ok: true, data: { userId: ctx.session.user.id } }),
    );

    const res = await handler(req());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, data: { userId: "u1" } });
  });

  it("returns 401 UNAUTHENTICATED and never calls the handler without a session", async () => {
    mocks.getSession.mockResolvedValue(null);
    const inner = vi.fn();
    const handler = withApiHandler({ logLabel: "api/thing" }, inner);

    const res = await handler(req());

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: { code: "UNAUTHENTICATED", message: "Not signed in." },
    });
    expect(inner).not.toHaveBeenCalled();
  });

  it("returns 403 CSRF_FAILED when csrf is required and the token is bad", async () => {
    mocks.validateCsrfFromRequest.mockReturnValue(false);
    const inner = vi.fn();
    const handler = withApiHandler({ logLabel: "api/thing", csrf: true }, inner);

    const res = await handler(req());

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: { code: "CSRF_FAILED", message: "Invalid request." },
    });
    expect(inner).not.toHaveBeenCalled();
  });

  it("does not check csrf unless asked", async () => {
    mocks.validateCsrfFromRequest.mockReturnValue(false);
    const handler = withApiHandler({ logLabel: "api/thing" }, async () =>
      NextResponse.json({ ok: true }),
    );

    expect((await handler(req())).status).toBe(200);
    expect(mocks.validateCsrfFromRequest).not.toHaveBeenCalled();
  });

  it("rate-limits on the user id, not the request IP", async () => {
    mocks.rateLimit.mockResolvedValue({ ok: false });
    const handler = withApiHandler(
      { logLabel: "api/thing", rateLimit: "picture" },
      async () => NextResponse.json({ ok: true }),
    );

    const res = await handler(req());

    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: { code: "RATE_LIMITED", message: "Too many requests. Try again shortly." },
    });
    expect(mocks.rateLimit).toHaveBeenCalledWith("picture", "u1");
  });

  // The order the routes had, and the order route-rate-limits.test.ts depends
  // on: an unauthenticated caller gets 401 before CSRF is ever consulted, and
  // a bad CSRF token gets 403 before the rate limiter is consulted.
  it("checks session, then csrf, then the rate limit", async () => {
    mocks.getSession.mockResolvedValue(null);
    const handler = withApiHandler(
      { logLabel: "api/thing", csrf: true, rateLimit: "picture" },
      async () => NextResponse.json({ ok: true }),
    );

    expect((await handler(req())).status).toBe(401);
    expect(mocks.validateCsrfFromRequest).not.toHaveBeenCalled();
    expect(mocks.rateLimit).not.toHaveBeenCalled();

    mocks.getSession.mockResolvedValue(SESSION);
    mocks.validateCsrfFromRequest.mockReturnValue(false);
    expect((await handler(req())).status).toBe(403);
    expect(mocks.rateLimit).not.toHaveBeenCalled();
  });

  it("converts a throw into the 500 envelope and logs it", async () => {
    const handler = withApiHandler({ logLabel: "api/thing" }, async () => {
      throw new Error("boom");
    });

    const res = await handler(req());

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." },
    });
    expect(console.error).toHaveBeenCalledWith(
      "[api/thing] unhandled error",
      expect.any(Error),
    );
  });

  // A dynamic route's second argument has to survive the wrapper.
  it("forwards the route context so dynamic segments still resolve", async () => {
    const handler = withApiHandler<{ params: Promise<{ id: string }> }>(
      { logLabel: "api/thing/[id]" },
      async (ctx) => {
        const { id } = await ctx.routeContext.params;
        return NextResponse.json({ ok: true, data: { id } });
      },
    );

    const res = await handler(req(), { params: Promise.resolve({ id: "abc" }) });
    await expect(res.json()).resolves.toEqual({ ok: true, data: { id: "abc" } });
  });
});
