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

import { POST } from "../route";
import { seedUser, seedSession, seedCategory, makeRequest, cleanupUser } from "./helpers";

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

describe("POST /api/transactions", () => {
  it("returns 401 when not signed in", async () => {
    const req = makeRequest({ method: "POST", body: {} });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("rejects requests with no CSRF token", async () => {
    const user = await seedUser();
    userId = user.id;
    const category = await seedCategory(user.id);
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const req = makeRequest({
      method: "POST",
      body: { description: "Rent", amount: 1600, categoryId: category.id, type: "expense", date: "2026-07-01" },
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("rejects malformed JSON body", async () => {
    const user = await seedUser();
    userId = user.id;
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const req = makeRequest({ method: "POST", csrfToken: "csrf", bodyOverride: "{not json" });
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
      body: { description: "", amount: -5, type: "bogus", date: "not-a-date" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.fieldErrors).toHaveProperty("description");
    expect(body.error.fieldErrors).toHaveProperty("amount");
    expect(body.error.fieldErrors).toHaveProperty("categoryId");
    expect(body.error.fieldErrors).toHaveProperty("type");
    expect(body.error.fieldErrors).toHaveProperty("date");
  });

  it("returns 400 when categoryId belongs to another user", async () => {
    const me = await seedUser();
    userId = me.id;
    const other = await seedUser();
    otherUserId = other.id;
    const otherCategory = await seedCategory(other.id);
    const { rawToken } = await seedSession(me.id);
    mocks.sessionToken = rawToken;

    const req = makeRequest({
      method: "POST",
      csrfToken: "csrf",
      body: { description: "Rent", amount: 1600, categoryId: otherCategory.id, type: "expense", date: "2026-07-01" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.fieldErrors).toHaveProperty("categoryId");
  });

  it("creates a transaction owned by the caller", async () => {
    const user = await seedUser();
    userId = user.id;
    const category = await seedCategory(user.id, { name: "Housing" });
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const req = makeRequest({
      method: "POST",
      csrfToken: "csrf",
      body: { description: "Rent", amount: 1600, categoryId: category.id, type: "expense", date: "2026-07-01" },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.transaction).toMatchObject({
      description: "Rent",
      amount: 1600,
      categoryId: category.id,
      type: "expense",
      date: "2026-07-01",
    });

    const row = await prisma.transaction.findUnique({ where: { id: body.data.transaction.id } });
    expect(row?.userId).toBe(user.id);
  });

  it("accepts a transfer-typed transaction (excluded from income/expense elsewhere)", async () => {
    const user = await seedUser();
    userId = user.id;
    const category = await seedCategory(user.id, { name: "Transfer", type: "transfer" });
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const req = makeRequest({
      method: "POST",
      csrfToken: "csrf",
      body: { description: "To savings", amount: 500, categoryId: category.id, type: "transfer", date: "2026-07-01" },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    expect((await res.json()).data.transaction.type).toBe("transfer");
  });
});
