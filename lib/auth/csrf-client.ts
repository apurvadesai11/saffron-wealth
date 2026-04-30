"use client";
import { CSRF_COOKIE_NAME } from "./csrf-shared";

export function readCsrfCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${CSRF_COOKIE_NAME}=([^;]+)`),
  );
  return match?.[1] ?? null;
}
