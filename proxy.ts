import { NextResponse, type NextRequest } from "next/server";
import { buildPageCsp } from "@/lib/security-headers";

// Edge runtime cannot run Prisma without Accelerate, so we do a CHEAP shape
// check on the session cookie here and let server components (`getSession()`
// in lib/auth/server.ts) do the real DB-backed validation.
//
// Three concerns live in this proxy:
//   1. Gate /(app)/* routes on the session cookie shape; redirect to /login
//      when missing/malformed (proxy.ts cannot hit Prisma in Edge runtime).
//   2. Issue the CSRF double-submit cookie on the response so client auth
//      forms can read it. Server Components can read but not write cookies in
//      Next.js 15+, so the proxy is the right home for this.
//   3. Attach the per-request CSP nonce. Next's App Router emits inline
//      bootstrap scripts on every page, so a static `script-src 'self'`
//      reports a violation per script and the only alternatives are
//      'unsafe-inline' or a nonce. Next reads the nonce off the REQUEST's
//      Content-Security-Policy header and applies it to its own inline
//      scripts, so it has to be set here — a header in next.config.ts cannot
//      vary per request. The static, non-varying headers stay in
//      next.config.ts.

const SESSION_COOKIE = "sw_session";
const SESSION_COOKIE_PROD = "__Host-sw_session";
const CSRF_COOKIE = "sw_csrf";

// Token is `randomBytes(32).toString("base64url")` => length 43.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,86}$/;

// /email-change is here because the confirmation link is opened from whatever
// device reads the NEW inbox, which is very often not signed in. Gating it
// would bounce the user to /login and strand the token; and the confirm POST
// needs the CSRF cookie this branch issues.
const AUTH_PATHS = [
  "/login",
  "/register",
  "/password-reset",
  "/email-change",
];

function isAuthPath(pathname: string): boolean {
  return AUTH_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

// Next extracts the nonce from the request's own CSP header, so the same value
// has to go on the request (for rendering) and the response (for the browser).
function withCsp(req: NextRequest, res?: NextResponse): NextResponse {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const nonce = base64url(bytes);
  const csp = buildPageCsp({
    nonce,
    dev: process.env.NODE_ENV === "development",
  });

  let out: NextResponse;
  if (res) {
    // A redirect renders nothing, so it needs no nonce propagation — just the
    // header on the way out.
    out = res;
  } else {
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("content-security-policy", csp);
    requestHeaders.set("x-nonce", nonce);
    out = NextResponse.next({ request: { headers: requestHeaders } });
  }
  out.headers.set("Content-Security-Policy", csp);
  return out;
}

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function ensureCsrfCookie(req: NextRequest, res: NextResponse): void {
  const existing = req.cookies.get(CSRF_COOKIE)?.value;
  if (existing && TOKEN_PATTERN.test(existing)) return;
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  res.cookies.set({
    name: CSRF_COOKIE,
    value: base64url(bytes),
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
  });
}

// Paths the middleware must never gate — static assets, Next internals, API
// routes, and public files. The matcher regex is a first filter but isn't
// reliable across all Next.js/Vercel versions, so we guard explicitly here too.
function isPassthrough(pathname: string): boolean {
  return (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/api/") ||
    pathname === "/favicon.ico" ||
    /^\/saffron\./.test(pathname)
  );
}

export function proxy(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  if (isPassthrough(pathname)) {
    return NextResponse.next();
  }

  if (isAuthPath(pathname)) {
    const res = withCsp(req);
    ensureCsrfCookie(req, res);
    return res;
  }

  const cookie =
    req.cookies.get(SESSION_COOKIE_PROD)?.value ??
    req.cookies.get(SESSION_COOKIE)?.value;

  if (!cookie || !TOKEN_PATTERN.test(cookie)) {
    const url = new URL("/login", req.url);
    const path = pathname + req.nextUrl.search;
    if (path && path !== "/login") url.searchParams.set("next", path);
    const res = withCsp(req, NextResponse.redirect(url));
    ensureCsrfCookie(req, res);
    return res;
  }

  return withCsp(req);
}

export const config = {
  matcher: [
    // Gate everything except auth API, cron endpoints, public assets,
    // Next internals, the favicon, and the brand image. Auth pages ARE
    // matched (we issue the CSRF cookie there); cron endpoints
    // self-authenticate via CRON_SECRET so we let them through directly.
    "/((?!api/auth|api/cron|_next/static|_next/image|favicon.ico|saffron\\.).*)",
  ],
};
