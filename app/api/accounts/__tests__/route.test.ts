import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

const mocks = vi.hoisted(() => ({ sessionToken: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      (name === "sw_session" || name === "__Host-sw_session") && mocks.sessionToken
        ? { value: mocks.sessionToken }
        : undefined,
  }),
}));

import { GET, POST } from "../route";
import { seedUser, seedSession, makeRequest, cleanupUser } from "./helpers";

let userId: string;
let otherUserId: string | undefined;

beforeEach(async () => {
  mocks.sessionToken = null;
});

afterEach(async () => {
  if (userId) await cleanupUser(userId);
  if (otherUserId) await cleanupUser(otherUserId);
  userId = "";
  otherUserId = undefined;
});

describe("GET /api/accounts", () => {
  it("returns 401 when not signed in", async () => {
    const res = await GET();
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
  });

  it("returns an empty list for a user with no accounts", async () => {
    const user = await seedUser();
    userId = user.id;
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).data.accounts).toEqual([]);
  });

  it("only returns the caller's own accounts (user isolation)", async () => {
    const me = await seedUser();
    userId = me.id;
    const other = await seedUser();
    otherUserId = other.id;

    await prisma.account.create({
      data: { userId: me.id, name: "My Brokerage", type: "brokerage", balance: 1000 },
    });
    await prisma.account.create({
      data: { userId: other.id, name: "Other's Cash", type: "cash", balance: 500 },
    });

    const { rawToken } = await seedSession(me.id);
    mocks.sessionToken = rawToken;

    const res = await GET();
    const body = await res.json();
    expect(body.data.accounts).toHaveLength(1);
    expect(body.data.accounts[0].name).toBe("My Brokerage");
  });

  it("does not return archived (soft-deleted) accounts", async () => {
    const user = await seedUser();
    userId = user.id;
    await prisma.account.create({
      data: { userId: user.id, name: "Gone", type: "cash", balance: 0, archivedAt: new Date() },
    });
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const res = await GET();
    expect((await res.json()).data.accounts).toEqual([]);
  });
});

describe("POST /api/accounts", () => {
  it("returns 401 when not signed in", async () => {
    const req = makeRequest({ method: "POST", body: {} });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("rejects requests with no CSRF token", async () => {
    const user = await seedUser();
    userId = user.id;
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const req = makeRequest({ method: "POST", body: { name: "X", type: "cash", balance: 1 } });
    const res = await POST(req);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("CSRF_FAILED");
  });

  it("rejects malformed JSON body", async () => {
    const user = await seedUser();
    userId = user.id;
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const req = makeRequest({
      method: "POST",
      csrfToken: "csrf",
      bodyOverride: "{not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("BAD_REQUEST");
  });

  it("returns field errors for invalid input", async () => {
    const user = await seedUser();
    userId = user.id;
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const req = makeRequest({
      method: "POST",
      csrfToken: "csrf",
      body: { name: "", type: "bogus", balance: -5 },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.fieldErrors).toHaveProperty("name");
    expect(body.error.fieldErrors).toHaveProperty("type");
    expect(body.error.fieldErrors).toHaveProperty("balance");
  });

  it("creates an account and exactly one opening balance-history event", async () => {
    const user = await seedUser();
    userId = user.id;
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const req = makeRequest({
      method: "POST",
      csrfToken: "csrf",
      body: { name: "Fidelity Brokerage", type: "brokerage", balance: 10000, institution: "Fidelity" },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.account).toMatchObject({
      name: "Fidelity Brokerage",
      type: "brokerage",
      institution: "Fidelity",
      balance: 10000,
    });

    const events = await prisma.accountBalanceEvent.findMany({
      where: { accountId: body.data.account.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0].balance.toNumber()).toBe(10000);
  });
});
