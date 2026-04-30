import type { NextRequest } from "next/server";

// Best-effort client IP. Trusts standard proxy headers in this order; for
// production behind a single trusted proxy (Vercel, NGINX), pin to the
// expected header instead of falling through.
export function clientIp(req: NextRequest): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip");
}

export function userAgent(req: NextRequest): string | null {
  return req.headers.get("user-agent");
}
