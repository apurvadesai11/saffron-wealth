import type { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "./server";
import { SESSION_TTL_DAYS } from "./sessions";

export function setSessionCookie(
  res: NextResponse,
  rawToken: string,
  expiresAt: Date,
): void {
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: rawToken,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires: expiresAt,
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}
