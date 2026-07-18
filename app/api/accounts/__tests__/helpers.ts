import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth/sessions";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "@/lib/auth/csrf-shared";

// Cloned from app/api/profile/__tests__/helpers.ts — see that file for the
// rationale on randomUUID emails and the cookie+header CSRF double-submit.

export async function seedUser() {
  const email = `accounts-test-${randomUUID()}@example.test`;
  return prisma.user.create({
    data: {
      email,
      emailNormalized: email.toLowerCase(),
      firstName: "Accounts",
      lastName: "Test",
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
  const url = opts.url ?? "http://localhost/api/accounts";
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
