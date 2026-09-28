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

describe("GET /api/transactions", () => {
  async function seedTx(
    uid: string,
    categoryId: string,
    fields: { date: string; amount: number; description: string },
  ) {
    const [y, m, d] = fields.date.split("-").map(Number);
    return prisma.transaction.create({
      data: {
        userId: uid,
        categoryId,
        description: fields.description,
        amount: fields.amount,
        type: "expense",
        date: new Date(Date.UTC(y, m - 1, d)),
      },
    });
  }

  it("returns 401 when not signed in", async () => {
    const req = makeRequest({ method: "GET" });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  // A read needs no CSRF token — requiring one here would break every
  // ordinary page load, which sends no such header.
  it("serves a signed-in read with no CSRF token", async () => {
    const user = await seedUser();
    userId = user.id;
    const category = await seedCategory(user.id);
    await seedTx(user.id, category.id, { date: "2026-09-01", amount: 12, description: "Coffee" });
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const res = await GET(makeRequest({ method: "GET" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.transactions.map((t: { description: string }) => t.description)).toEqual(["Coffee"]);
    expect(body.data.total).toBe(1);
    expect(body.data.nextCursor).toBeNull();
  });

  it("applies a filter from the query string", async () => {
    const user = await seedUser();
    userId = user.id;
    const category = await seedCategory(user.id);
    await seedTx(user.id, category.id, { date: "2026-08-01", amount: 5, description: "Older" });
    await seedTx(user.id, category.id, { date: "2026-09-15", amount: 5, description: "Newer" });
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const res = await GET(
      makeRequest({ method: "GET", url: "http://localhost/api/transactions?from=2026-09-01" }),
    );

    const body = await res.json();
    expect(body.data.transactions.map((t: { description: string }) => t.description)).toEqual(["Newer"]);
    expect(body.data.total).toBe(1);
  });

  it("returns 400 with a field error on a malformed date param", async () => {
    const user = await seedUser();
    userId = user.id;
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const res = await GET(
      makeRequest({ method: "GET", url: "http://localhost/api/transactions?from=not-a-date" }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.fieldErrors.from).toBeDefined();
  });

  it("never returns another user's transactions", async () => {
    const user = await seedUser();
    userId = user.id;
    const category = await seedCategory(user.id);
    await seedTx(user.id, category.id, { date: "2026-09-01", amount: 1, description: "Mine" });

    const other = await seedUser();
    otherUserId = other.id;
    const otherCategory = await seedCategory(other.id);
    await seedTx(other.id, otherCategory.id, { date: "2026-09-02", amount: 2, description: "Theirs" });

    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const res = await GET(makeRequest({ method: "GET" }));

    const body = await res.json();
    expect(body.data.transactions.map((t: { description: string }) => t.description)).toEqual(["Mine"]);
    expect(body.data.total).toBe(1);
  });
});

describe("POST /api/transactions at the Decimal(14,2) boundary", () => {
  // The user-visible half of item 8: exactly 1e12 passed validation and then
  // overflowed the column, so the route answered 500 INTERNAL_ERROR on input
  // that should have been a clean 400 field error.
  it("rejects amount 1e12 with a 400 field error, not a 500", async () => {
    const user = await seedUser();
    userId = user.id;
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;
    const category = await seedCategory(user.id);

    const res = await POST(
      makeRequest({
        method: "POST",
        csrfToken: "csrf",
        body: {
          categoryId: category.id,
          description: "Boundary probe",
          amount: 1e12,
          type: "expense",
          date: "2026-03-01",
        },
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.fieldErrors?.amount).toBeTruthy();
  });

  it("stores the largest value the column can hold", async () => {
    // Proves the accepted bound is actually storable, rather than just being
    // one less than the old broken one.
    const user = await seedUser();
    userId = user.id;
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;
    const category = await seedCategory(user.id);

    const res = await POST(
      makeRequest({
        method: "POST",
        csrfToken: "csrf",
        body: {
          categoryId: category.id,
          description: "Maximum",
          amount: 999999999999.99,
          type: "expense",
          date: "2026-03-01",
        },
      }),
    );

    expect(res.status).toBe(201);
    const stored = await prisma.transaction.findFirst({
      where: { userId: user.id },
      select: { amount: true },
    });
    expect(Number(stored?.amount)).toBe(999999999999.99);
  });

  it("rejects an amountMax filter of exactly 1e12 with a 400", async () => {
    const user = await seedUser();
    userId = user.id;
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const res = await GET(
      makeRequest({
        method: "GET",
        url: "http://localhost/api/transactions?amountMax=1000000000000",
      }),
    );
    expect(res.status).toBe(400);
  });
});
