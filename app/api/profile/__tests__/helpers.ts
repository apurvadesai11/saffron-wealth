import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth/sessions";
import { hashPassword } from "@/lib/auth/password";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "@/lib/auth/csrf-shared";

// Each test file declares its own `vi.hoisted(...)` mock state and toggles
// `mocks.sessionToken` to control what getSession() sees via the mocked
// `next/headers` module. This helper file just provides DB seeding + the
// NextRequest builder; the session mock lives at the test-file level so
// parallel test files don't share session state.

/**
 * Create a real User row in the test DB. Returns user + a hashed password
 * placeholder. Tests pass `password` when they need a verifiable hash (e.g.
 * change-password flow); omit it for Google-only users.
 *
 * Email uses randomUUID so parallel test files don't collide on the unique
 * constraint — a per-file counter + Date.now() is NOT enough because
 * different vitest workers can hit the same millisecond.
 */
export async function seedUser(opts: { password?: string } = {}) {
  const email = `api-test-${randomUUID()}@example.test`;
  return prisma.user.create({
    data: {
      email,
      emailNormalized: email.toLowerCase(),
      firstName: "Api",
      lastName: "Test",
      passwordHash: opts.password ? await hashPassword(opts.password) : null,
    },
  });
}

export async function seedSession(userId: string) {
  return createSession(userId, "vitest", "127.0.0.1");
}

/**
 * Build a NextRequest with optional CSRF token and JSON body. The CSRF token,
 * when provided, is set as both cookie and header so validateCsrfFromRequest
 * accepts it.
 */
export function makeRequest(opts: {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  url?: string;
  body?: unknown;
  csrfToken?: string | null;
  contentType?: string;
  contentLength?: number;
  bodyOverride?: BodyInit;
}): NextRequest {
  const url = opts.url ?? "http://localhost/api/profile";
  const headers = new Headers();
  if (opts.csrfToken) {
    headers.set(CSRF_HEADER_NAME, opts.csrfToken);
  }
  if (opts.contentType) headers.set("content-type", opts.contentType);
  if (opts.contentLength !== undefined) {
    headers.set("content-length", String(opts.contentLength));
  }

  let body: BodyInit | undefined;
  if (opts.bodyOverride !== undefined) {
    body = opts.bodyOverride;
  } else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
  }

  const req = new NextRequest(url, { method: opts.method, headers, body });
  if (opts.csrfToken) {
    req.cookies.set(CSRF_COOKIE_NAME, opts.csrfToken);
  }
  return req;
}

export async function cleanupUser(userId: string) {
  // Cascade via schema relations: sessions, oauth, reset tokens, failed
  // logins, audit events all delete on user delete.
  await prisma.user.delete({ where: { id: userId } }).catch(() => {});
}
