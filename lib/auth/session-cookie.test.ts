// The plan's second-priority gap: "session-cookie naming differs between
// production (__Host-sw_session) and dev (sw_session), which is exactly the
// kind of environment-dependent branch tests should pin."
//
// Both the name and the `secure` flag are decided at module load from
// NODE_ENV, so each environment is exercised by resetting the module registry
// and re-importing — reading the constant once would only ever test whichever
// environment the runner happens to be in.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextResponse } from "next/server";

async function loadFor(nodeEnv: string) {
  vi.stubEnv("NODE_ENV", nodeEnv);
  vi.resetModules();
  const [cookie, server, sessions] = await Promise.all([
    import("./session-cookie"),
    import("./server"),
    import("./sessions"),
  ]);
  return {
    setSessionCookie: cookie.setSessionCookie,
    clearSessionCookie: cookie.clearSessionCookie,
    SESSION_COOKIE_NAME: server.SESSION_COOKIE_NAME,
    SESSION_TTL_DAYS: sessions.SESSION_TTL_DAYS,
  };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("SESSION_COOKIE_NAME", () => {
  // __Host- is not decoration: the prefix is only accepted by the browser when
  // the cookie is Secure, has Path=/, and carries no Domain. It is what stops a
  // subdomain from writing a session cookie for the parent.
  it("uses the __Host- prefixed name in production", async () => {
    const { SESSION_COOKIE_NAME } = await loadFor("production");
    expect(SESSION_COOKIE_NAME).toBe("__Host-sw_session");
  });

  it("uses the unprefixed name outside production, where there is no TLS", async () => {
    const { SESSION_COOKIE_NAME } = await loadFor("development");
    expect(SESSION_COOKIE_NAME).toBe("sw_session");
  });

  it("treats test like development, which is why route tests read sw_session", async () => {
    const { SESSION_COOKIE_NAME } = await loadFor("test");
    expect(SESSION_COOKIE_NAME).toBe("sw_session");
  });
});

describe("setSessionCookie", () => {
  it("writes the raw token under the environment's cookie name", async () => {
    const { setSessionCookie, SESSION_COOKIE_NAME } = await loadFor("test");
    const res = NextResponse.json({ ok: true });

    setSessionCookie(res, "raw-token-value", new Date("2026-12-31T00:00:00.000Z"));

    expect(res.cookies.get(SESSION_COOKIE_NAME)?.value).toBe("raw-token-value");
  });

  it("is httpOnly, SameSite=strict and scoped to the whole site", async () => {
    const { setSessionCookie, SESSION_COOKIE_NAME } = await loadFor("test");
    const res = NextResponse.json({ ok: true });

    setSessionCookie(res, "t", new Date("2026-12-31T00:00:00.000Z"));
    const c = res.cookies.get(SESSION_COOKIE_NAME)!;

    // httpOnly keeps it away from XSS; strict is what makes the CSRF
    // double-submit pattern a belt-and-braces measure rather than the only one.
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe("strict");
    expect(c.path).toBe("/");
  });

  // The two halves of the __Host- contract have to agree: the prefixed name is
  // rejected outright by the browser if the cookie isn't Secure.
  it("sets Secure in production and not outside it", async () => {
    const prod = await loadFor("production");
    const prodRes = NextResponse.json({ ok: true });
    prod.setSessionCookie(prodRes, "t", new Date("2026-12-31T00:00:00.000Z"));
    expect(prodRes.cookies.get(prod.SESSION_COOKIE_NAME)?.secure).toBe(true);

    const dev = await loadFor("development");
    const devRes = NextResponse.json({ ok: true });
    dev.setSessionCookie(devRes, "t", new Date("2026-12-31T00:00:00.000Z"));
    expect(devRes.cookies.get(dev.SESSION_COOKIE_NAME)?.secure).toBe(false);
  });

  // Worth pinning because the answer is not what the call site suggests.
  // setSessionCookie passes BOTH `expires` (the session row's own expiry) and
  // `maxAge` (SESSION_TTL_DAYS from now), and Max-Age wins over Expires per
  // RFC 6265 — Next's ResponseCookies recomputes `expires` from `maxAge`
  // accordingly. So the cookie's lifetime is always "TTL from now", and the
  // `expires` argument is effectively redundant.
  //
  // Not a live bug: createSession sets expiresAt to now + SESSION_TTL_DAYS, so
  // the two agree at every current call site. It would become one if a caller
  // ever issued a session with a different expiry and expected the cookie to
  // match, which is exactly why it is written down here.
  it("takes its lifetime from the TTL, so the expiresAt argument is redundant", async () => {
    const { setSessionCookie, SESSION_COOKIE_NAME, SESSION_TTL_DAYS } = await loadFor("test");
    const res = NextResponse.json({ ok: true });
    const ttlSeconds = SESSION_TTL_DAYS * 24 * 60 * 60;

    // Deliberately far from now + TTL, to show which one the cookie follows.
    setSessionCookie(res, "t", new Date("2030-12-31T00:00:00.000Z"));
    const c = res.cookies.get(SESSION_COOKIE_NAME)!;

    expect(c.maxAge).toBe(ttlSeconds);
    const expiresMs = new Date(c.expires!).getTime();
    const expectedMs = Date.now() + ttlSeconds * 1000;
    expect(Math.abs(expiresMs - expectedMs)).toBeLessThan(10_000);
  });
});

describe("clearSessionCookie", () => {
  it("overwrites the cookie with an empty value and maxAge 0", async () => {
    const { clearSessionCookie, SESSION_COOKIE_NAME } = await loadFor("test");
    const res = NextResponse.json({ ok: true });

    clearSessionCookie(res);
    const c = res.cookies.get(SESSION_COOKIE_NAME)!;

    expect(c.value).toBe("");
    expect(c.maxAge).toBe(0);
  });

  // The clear has to match the set on every attribute the browser keys on, or
  // it writes a second cookie instead of replacing the first — and the user
  // stays signed in after clicking Sign out.
  it("matches setSessionCookie's name, path and flags so it actually replaces it", async () => {
    for (const env of ["production", "development"]) {
      const { setSessionCookie, clearSessionCookie, SESSION_COOKIE_NAME } = await loadFor(env);

      const setRes = NextResponse.json({ ok: true });
      setSessionCookie(setRes, "t", new Date("2026-12-31T00:00:00.000Z"));
      const set = setRes.cookies.get(SESSION_COOKIE_NAME)!;

      const clearRes = NextResponse.json({ ok: true });
      clearSessionCookie(clearRes);
      const cleared = clearRes.cookies.get(SESSION_COOKIE_NAME)!;

      expect(cleared.name, env).toBe(set.name);
      expect(cleared.path, env).toBe(set.path);
      expect(cleared.secure, env).toBe(set.secure);
      expect(cleared.sameSite, env).toBe(set.sameSite);
      expect(cleared.httpOnly, env).toBe(set.httpOnly);
    }
  });
});
