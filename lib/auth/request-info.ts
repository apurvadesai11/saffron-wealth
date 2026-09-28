import type { NextRequest } from "next/server";

/**
 * Best-effort client IP, from the proxy headers we can actually trust.
 *
 * `X-Forwarded-For` is append-only: the LEFT-most entry is whatever the
 * original client claimed and the RIGHT-most is what the nearest trusted proxy
 * observed. This read the left-most one, which made every IP-keyed rate limit
 * (login, register, password reset) bypassable by rotating a header value, and
 * every `ipAddress` in the audit log and the FailedLogin table
 * attacker-controlled fiction.
 *
 * Preference order:
 *   1. `x-vercel-forwarded-for` — set and overwritten by Vercel's edge, so it
 *      cannot be forged by the client.
 *   2. The right-most `x-forwarded-for` entry — what our own proxy saw.
 *   3. `x-real-ip` — single-value header, typically set by NGINX.
 *
 * INVARIANT, and the thing to revisit before changing topology: this assumes
 * exactly ONE trusted proxy in front of the app. Behind two, the right-most
 * entry is the inner proxy rather than the client, and this would need to skip
 * a known number of trusted hops instead. In local development none of these
 * headers exist and the result is null, which is correct — there is no proxy,
 * so there is nothing to trust.
 */
export function clientIp(req: NextRequest): string | null {
  const vercel = req.headers.get("x-vercel-forwarded-for");
  if (vercel) {
    const observed = rightmost(vercel);
    if (observed) return observed;
  }

  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const observed = rightmost(xff);
    if (observed) return observed;
  }

  const realIp = req.headers.get("x-real-ip")?.trim();
  return realIp ? realIp : null;
}

// The last non-empty entry in a comma-separated proxy chain. A trailing comma
// or a stray empty element must not resolve to "", which would then be used as
// a rate-limit key shared by every such request.
function rightmost(headerValue: string): string | null {
  const parts = headerValue
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return parts.length > 0 ? parts[parts.length - 1] : null;
}

export function userAgent(req: NextRequest): string | null {
  return req.headers.get("user-agent");
}
