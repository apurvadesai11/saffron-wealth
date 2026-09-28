import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth/sessions";
import { hashPassword } from "@/lib/auth/password";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "@/lib/auth/csrf-shared";

// Cloned from app/api/accounts/__tests__/helpers.ts (itself a documented clone
// of the profile one) — see that file for the rationale on randomUUID emails
// and the cookie+header CSRF double-submit.
//
// This directory did not exist before the audit: login, register, logout,
// logout-all, me, the OAuth callback and both password-reset routes had no
// route-level tests at all.

export async function seedUser(opts: { password?: string; email?: string } = {}) {
  const email = opts.email ?? `auth-test-${randomUUID()}@example.test`;
  return prisma.user.create({
    data: {
      email,
      emailNormalized: email.toLowerCase(),
      firstName: "Auth",
      lastName: "Test",
      ...(opts.password ? { passwordHash: await hashPassword(opts.password) } : {}),
    },
  });
}

export async function seedSession(userId: string) {
  return createSession(userId, "vitest", "127.0.0.1");
}

export function makeRequest(opts: {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  url?: string;
  body?: unknown;
  csrfToken?: string | null;
  bodyOverride?: BodyInit;
}): NextRequest {
  const url = opts.url ?? "http://localhost/api/auth/email-change/confirm";
  const headers = new Headers();
  if (opts.csrfToken) headers.set(CSRF_HEADER_NAME, opts.csrfToken);

  let body: BodyInit | undefined;
  if (opts.bodyOverride !== undefined) {
    body = opts.bodyOverride;
  } else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers.set("content-type", "application/json");
  }

  const req = new NextRequest(url, { method: opts.method, headers, body });
  if (opts.csrfToken) {
    req.cookies.set(CSRF_COOKIE_NAME, opts.csrfToken);
  }
  return req;
}

export async function cleanupUser(userId: string) {
  await prisma.user.delete({ where: { id: userId } }).catch(() => {});
}

export async function authEventTypes(userId: string): Promise<string[]> {
  const rows = await prisma.authEvent.findMany({
    where: { userId },
    select: { type: true },
  });
  return rows.map(r => r.type);
}
