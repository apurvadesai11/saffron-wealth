import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

const mocks = vi.hoisted(() => ({
  sessionToken: null as string | null,
  hibpPwned: false,
  hibpUnavailable: false,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      (name === "sw_session" || name === "__Host-sw_session") && mocks.sessionToken
        ? { value: mocks.sessionToken }
        : undefined,
  }),
}));

// Avoid hitting the real Pwned Passwords API in tests. Per-test toggles let
// us flip between pwned/unavailable/clean without network jitter.
vi.mock("@/lib/auth/hibp", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/hibp")>(
    "@/lib/auth/hibp",
  );
  return {
    ...actual,
    checkPwnedPassword: vi.fn(async () => ({
      pwned: mocks.hibpPwned,
      unavailable: mocks.hibpUnavailable,
    })),
  };
});

import { POST } from "../change-password/route";
import { seedUser, seedSession, makeRequest, cleanupUser } from "./helpers";

const GOOD_PASSWORD = "OldPassword!2345";
// Strong-ish, not in the common blocklist; HIBP is mocked so this won't actually be checked.
const NEW_PASSWORD = "FreshSecret!9876xyz";

let userId: string;
beforeEach(() => {
  mocks.sessionToken = null;
  mocks.hibpPwned = false;
  mocks.hibpUnavailable = false;
});
afterEach(async () => {
  if (userId) await cleanupUser(userId);
  userId = "";
});

describe("POST /api/profile/change-password", () => {
  it("returns 401 when not signed in", async () => {
    const req = makeRequest({
      method: "POST",
      csrfToken: "csrf",
      body: { currentPassword: "x", newPassword: "y" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 403 when CSRF is missing", async () => {
    const user = await seedUser({ password: GOOD_PASSWORD });
    userId = user.id;
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const req = makeRequest({
      method: "POST",
      body: { currentPassword: GOOD_PASSWORD, newPassword: NEW_PASSWORD },
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("returns 400 when fields are missing", async () => {
    const user = await seedUser({ password: GOOD_PASSWORD });
    userId = user.id;
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const req = makeRequest({
      method: "POST",
      csrfToken: "csrf",
      body: { currentPassword: GOOD_PASSWORD },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("BAD_REQUEST");
  });

  it("returns 400 NO_PASSWORD_SET for Google-only users (no passwordHash)", async () => {
    const user = await seedUser(); // no password
    userId = user.id;
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const req = makeRequest({
      method: "POST",
      csrfToken: "csrf",
      body: { currentPassword: "anything", newPassword: NEW_PASSWORD },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("NO_PASSWORD_SET");
  });

  it("returns 400 INVALID_CURRENT_PASSWORD on wrong current password", async () => {
    const user = await seedUser({ password: GOOD_PASSWORD });
    userId = user.id;
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const req = makeRequest({
      method: "POST",
      csrfToken: "csrf",
      body: { currentPassword: "wrong-password-xyz", newPassword: NEW_PASSWORD },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_CURRENT_PASSWORD");
  });

  it("returns 400 VALIDATION_FAILED when new password violates rules (too short)", async () => {
    const user = await seedUser({ password: GOOD_PASSWORD });
    userId = user.id;
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const req = makeRequest({
      method: "POST",
      csrfToken: "csrf",
      body: { currentPassword: GOOD_PASSWORD, newPassword: "short1!" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_FAILED");
  });

  it("returns 400 PASSWORD_TOO_COMMON when new password is in the blocklist", async () => {
    const user = await seedUser({ password: GOOD_PASSWORD });
    userId = user.id;
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    // Needs ≥12 chars (rules check) AND be in blocklist-data. "saffronwealth"
    // is hand-curated into the app's local blocklist.
    const req = makeRequest({
      method: "POST",
      csrfToken: "csrf",
      body: { currentPassword: GOOD_PASSWORD, newPassword: "saffronwealth" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("PASSWORD_TOO_COMMON");
  });

  it("returns 400 PASSWORD_PWNED when HIBP reports pwned", async () => {
    const user = await seedUser({ password: GOOD_PASSWORD });
    userId = user.id;
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;
    mocks.hibpPwned = true;

    const req = makeRequest({
      method: "POST",
      csrfToken: "csrf",
      body: { currentPassword: GOOD_PASSWORD, newPassword: NEW_PASSWORD },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("PASSWORD_PWNED");
  });

  it("happy path: updates hash, revokes all sessions, issues a fresh one, clears failed-login rows", async () => {
    const user = await seedUser({ password: GOOD_PASSWORD });
    userId = user.id;
    await seedSession(user.id);
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    // Seed a failed-login row to verify it gets cleared.
    await prisma.failedLogin.create({
      data: { emailNormalized: user.emailNormalized, userId: user.id },
    });

    const req = makeRequest({
      method: "POST",
      csrfToken: "csrf",
      body: { currentPassword: GOOD_PASSWORD, newPassword: NEW_PASSWORD },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const sessions = await prisma.session.findMany({ where: { userId: user.id } });
    expect(sessions).toHaveLength(1);

    const failed = await prisma.failedLogin.findMany({ where: { userId: user.id } });
    expect(failed).toHaveLength(0);

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/sw_session=/i);

    const updated = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updated?.passwordHash).not.toBe(user.passwordHash);
  });
});
