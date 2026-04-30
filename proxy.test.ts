import { describe, it, expect } from "vitest";
import { proxy } from "./proxy";

// Minimal NextRequest stand-in — only the fields proxy() reads.
function makeReq(pathname: string, cookies: Record<string, string> = {}): Parameters<typeof proxy>[0] {
  const url = new URL(`http://localhost${pathname}`);
  return {
    nextUrl: { pathname: url.pathname, search: url.search },
    url: url.toString(),
    cookies: {
      get: (name: string) => (name in cookies ? { value: cookies[name] } : undefined),
    },
  } as unknown as Parameters<typeof proxy>[0];
}

const VALID_TOKEN = "e2e_test_fake_session_cookie_42chars_aabbcc"; // 43 chars, matches TOKEN_PATTERN

describe("proxy — passthrough (never gated)", () => {
  const passthroughPaths = [
    "/_next/static/chunks/main-app-abc123.js",
    "/_next/static/css/styles.css",
    "/_next/image?url=foo",
    "/_next/webpack-hmr",
    "/api/auth/login",
    "/api/auth/logout",
    "/api/cron/sweep-sessions",
    "/favicon.ico",
    "/saffron.jpg",
    "/saffron.png",
  ];

  for (const path of passthroughPaths) {
    it(`passes through ${path} without redirect`, () => {
      const res = proxy(makeReq(path));
      // NextResponse.next() has no Location header; redirects do.
      expect((res as Response).headers?.get("location")).toBeNull();
    });
  }
});

describe("proxy — auth pages (pass through + CSRF cookie)", () => {
  const authPaths = ["/login", "/register", "/password-reset", "/password-reset/abc123"];

  for (const path of authPaths) {
    it(`allows unauthenticated access to ${path}`, () => {
      const res = proxy(makeReq(path));
      expect((res as Response).headers?.get("location")).toBeNull();
    });
  }
});

describe("proxy — protected routes (redirect when no session)", () => {
  const protectedPaths = ["/", "/transactions", "/profile", "/budget"];

  for (const path of protectedPaths) {
    it(`redirects unauthenticated request to ${path} → /login`, () => {
      const res = proxy(makeReq(path));
      const location = (res as Response).headers?.get("location") ?? "";
      expect(location).toMatch(/\/login/);
    });

    it(`redirects with next param for ${path}`, () => {
      const res = proxy(makeReq(path));
      const location = (res as Response).headers?.get("location") ?? "";
      const url = new URL(location, "http://localhost");
      expect(url.searchParams.get("next")).toBe(path);
    });

    it(`allows authenticated request to ${path}`, () => {
      const res = proxy(makeReq(path, { sw_session: VALID_TOKEN }));
      expect((res as Response).headers?.get("location")).toBeNull();
    });

    it(`rejects malformed session cookie for ${path}`, () => {
      const res = proxy(makeReq(path, { sw_session: "short" }));
      const location = (res as Response).headers?.get("location") ?? "";
      expect(location).toMatch(/\/login/);
    });
  }
});

describe("proxy — production session cookie name", () => {
  it("accepts __Host-sw_session in addition to sw_session", () => {
    const res = proxy(makeReq("/", { "__Host-sw_session": VALID_TOKEN }));
    expect((res as Response).headers?.get("location")).toBeNull();
  });
});
