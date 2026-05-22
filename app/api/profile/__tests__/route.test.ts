import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// `next/headers` cookies() is the gate getSession() reads. We swap it with a
// module-scoped state holder so individual tests can toggle the session.
const mocks = vi.hoisted(() => ({ sessionToken: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      (name === "sw_session" || name === "__Host-sw_session") && mocks.sessionToken
        ? { value: mocks.sessionToken }
        : undefined,
  }),
}));

import { GET, PATCH } from "../route";
import { seedUser, seedSession, makeRequest, cleanupUser } from "./helpers";

let userId: string;

beforeEach(async () => {
  mocks.sessionToken = null;
});

afterEach(async () => {
  if (userId) await cleanupUser(userId);
  userId = "";
});

describe("GET /api/profile", () => {
  it("returns 401 when not signed in", async () => {
    const res = await GET();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns the signed-in user when authenticated", async () => {
    const user = await seedUser();
    userId = user.id;
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.user).toMatchObject({
      id: user.id,
      email: user.email,
      firstName: "Api",
    });
    expect(body.data.user.passwordHash).toBeUndefined();
  });
});

describe("PATCH /api/profile", () => {
  it("returns 401 when not signed in", async () => {
    const req = makeRequest({ method: "PATCH", csrfToken: "csrf", body: {} });
    const res = await PATCH(req);
    expect(res.status).toBe(401);
  });

  it("rejects requests with no CSRF token", async () => {
    const user = await seedUser();
    userId = user.id;
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const req = makeRequest({ method: "PATCH", body: { firstName: "X" } });
    const res = await PATCH(req);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("CSRF_FAILED");
  });

  it("rejects malformed JSON body", async () => {
    const user = await seedUser();
    userId = user.id;
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const req = makeRequest({
      method: "PATCH",
      csrfToken: "csrf",
      bodyOverride: "{not json",
      contentType: "application/json",
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("BAD_REQUEST");
  });

  it("returns field error for invalid firstName", async () => {
    const user = await seedUser();
    userId = user.id;
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const req = makeRequest({
      method: "PATCH",
      csrfToken: "csrf",
      body: { firstName: "" },
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.fieldErrors).toHaveProperty("firstName");
  });

  it("returns field error for invalid email", async () => {
    const user = await seedUser();
    userId = user.id;
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const req = makeRequest({
      method: "PATCH",
      csrfToken: "csrf",
      body: { email: "no-at-sign" },
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.fieldErrors).toHaveProperty("email");
  });

  it("updates firstName without revoking sessions", async () => {
    const user = await seedUser();
    userId = user.id;
    const s1 = await seedSession(user.id);
    const s2 = await seedSession(user.id);
    mocks.sessionToken = s1.rawToken;

    const req = makeRequest({
      method: "PATCH",
      csrfToken: "csrf",
      body: { firstName: "Renamed" },
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.user.firstName).toBe("Renamed");

    const sessions = await prisma.session.findMany({ where: { userId: user.id } });
    expect(sessions).toHaveLength(2);
    void s2;
  });

  it("returns 409 when changing email to one another user owns", async () => {
    const other = await seedUser();
    const me = await seedUser();
    userId = me.id;
    const { rawToken } = await seedSession(me.id);
    mocks.sessionToken = rawToken;

    const req = makeRequest({
      method: "PATCH",
      csrfToken: "csrf",
      body: { email: other.email },
    });
    const res = await PATCH(req);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("EMAIL_EXISTS");

    await cleanupUser(other.id);
  });

  it("changes email, revokes all old sessions, and issues a fresh one via Set-Cookie", async () => {
    const user = await seedUser();
    userId = user.id;
    await seedSession(user.id);
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const newEmail = `new-${Date.now()}@example.test`;
    const req = makeRequest({
      method: "PATCH",
      csrfToken: "csrf",
      body: { email: newEmail },
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    expect((await res.json()).data.user.email).toBe(newEmail);

    const sessions = await prisma.session.findMany({ where: { userId: user.id } });
    expect(sessions).toHaveLength(1);

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/sw_session=/i);
  });

  it("treats case-only email 'change' as a no-op (sessions untouched)", async () => {
    const user = await seedUser();
    userId = user.id;
    await seedSession(user.id);
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const req = makeRequest({
      method: "PATCH",
      csrfToken: "csrf",
      body: { email: user.email.toUpperCase() },
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);

    const sessions = await prisma.session.findMany({ where: { userId: user.id } });
    expect(sessions).toHaveLength(2);
  });
});
