/**
 * Security headers and CSP construction.
 *
 * Shared by next.config.ts (static headers, plus the CSP for API responses)
 * and proxy.ts (the per-request nonce CSP for HTML). Kept in one place so the
 * two cannot drift into disagreeing about what is allowed.
 */

export const STATIC_SECURITY_HEADERS: { key: string; value: string }[] = [
  // Duplicated by the CSP's frame-ancestors on purpose: this header covers
  // browsers that never implemented the directive.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

// Avatars are stored as remote URLs and rendered with `unoptimized`, so the
// browser fetches them cross-origin rather than through Next's optimizer.
const IMG_SOURCES = [
  "'self'",
  "data:",
  "blob:",
  "https://*.public.blob.vercel-storage.com",
  "https://lh3.googleusercontent.com",
].join(" ");

/**
 * The CSP for HTML responses.
 *
 * Next's App Router emits inline bootstrap and hydration scripts on every
 * page, so `script-src 'self'` alone reports a violation per script. The two
 * ways out are `'unsafe-inline'` — which forfeits most of what a CSP is for —
 * and a per-request nonce, which Next propagates to its own inline scripts
 * when the middleware puts it on the request. This app renders account
 * balances, so it takes the nonce.
 *
 * `'strict-dynamic'` lets a nonced script load the chunks it needs without
 * enumerating them, and makes host allowlists redundant in supporting
 * browsers.
 *
 * `style-src` keeps `'unsafe-inline'`: Tailwind emits a real stylesheet, but
 * next/font injects inline styles that carry no nonce. Styles are a far weaker
 * vector than scripts, which do not get the same latitude.
 */
export function buildPageCsp(opts: { nonce: string; dev: boolean }): string {
  return [
    "default-src 'self'",
    // Dev only: the React refresh runtime evaluates code at runtime.
    `script-src 'self' 'nonce-${opts.nonce}' 'strict-dynamic'${opts.dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${IMG_SOURCES}`,
    // next/font self-hosts Geist at build time, so no fonts.googleapis.com.
    "font-src 'self'",
    // Every fetch in the app is same-origin. Dev also needs the HMR websocket.
    `connect-src 'self'${opts.dev ? " ws: wss:" : ""}`,
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

/**
 * The CSP for API responses.
 *
 * A JSON response never executes script or loads a subresource, so it does not
 * need a nonce and gets a far tighter policy. It still needs framing and
 * sniffing protection, which is why it gets a CSP at all.
 */
export function buildApiCsp(): string {
  return [
    "default-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}
