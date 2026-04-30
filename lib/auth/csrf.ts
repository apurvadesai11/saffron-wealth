import { randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "./csrf-shared";

export { CSRF_COOKIE_NAME, CSRF_HEADER_NAME };
const CSRF_TOKEN_BYTES = 32;

// Issue (or read existing) CSRF cookie from a Server Component / Server Action
// context. Non-HttpOnly so the client JS can read it for the double-submit;
// SameSite=Strict and Secure ensure cross-site requests can't read or send it.
export async function ensureCsrfCookie(): Promise<string> {
  const store = await cookies();
  const existing = store.get(CSRF_COOKIE_NAME)?.value;
  if (existing && /^[A-Za-z0-9_-]{32,}$/.test(existing)) return existing;
  const fresh = randomBytes(CSRF_TOKEN_BYTES).toString("base64url");
  store.set(CSRF_COOKIE_NAME, fresh, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
  });
  return fresh;
}

// Validate that the request's CSRF header equals the cookie. Constant-time
// compare. Returns false if either is missing/malformed.
export function validateCsrfFromRequest(req: NextRequest): boolean {
  const headerToken = req.headers.get(CSRF_HEADER_NAME);
  const cookieToken = req.cookies.get(CSRF_COOKIE_NAME)?.value;
  if (!headerToken || !cookieToken) return false;
  if (headerToken.length !== cookieToken.length) return false;
  try {
    return timingSafeEqual(
      Buffer.from(headerToken, "utf8"),
      Buffer.from(cookieToken, "utf8"),
    );
  } catch {
    return false;
  }
}
