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

import { PATCH, DELETE } from "../[id]/route";
import { seedUser, seedSession, seedCategory, makeRequest, cleanupUser } from "./helpers";

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

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

describe("DELETE /api/transactions/[id]", () => {
  it("returns 401 when not signed in", async () => {
    const req = makeRequest({ method: "DELETE" });
    const res = await DELETE(req, params("nonexistent"));
    expect(res.status).toBe(401);
  });

  it("rejects requests with no CSRF token", async () => {
    const user = await seedUser();
    userId = user.id;
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const req = makeRequest({ method: "DELETE" });
    const res = await DELETE(req, params("nonexistent"));
    expect(res.status).toBe(403);
  });

  it("returns 404 when the transaction belongs to another user", async () => {
    const me = await seedUser();
    userId = me.id;
    const other = await seedUser();
    otherUserId = other.id;
    const category = await seedCategory(other.id);
    const tx = await prisma.transaction.create({
      data: { userId: other.id, categoryId: category.id, description: "Not mine", amount: 10, type: "expense", date: new Date("2026-07-01") },
    });
    const { rawToken } = await seedSession(me.id);
    mocks.sessionToken = rawToken;

    const req = makeRequest({ method: "DELETE", csrfToken: "csrf" });
    const res = await DELETE(req, params(tx.id));
    expect(res.status).toBe(404);
  });

  it("deletes the caller's transaction", async () => {
    const user = await seedUser();
    userId = user.id;
    const category = await seedCategory(user.id);
    const tx = await prisma.transaction.create({
      data: { userId: user.id, categoryId: category.id, description: "Mine", amount: 10, type: "expense", date: new Date("2026-07-01") },
    });
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const req = makeRequest({ method: "DELETE", csrfToken: "csrf" });
    const res = await DELETE(req, params(tx.id));
    expect(res.status).toBe(200);

    const row = await prisma.transaction.findUnique({ where: { id: tx.id } });
    expect(row).toBeNull();
  });
});

describe("PATCH /api/transactions/[id]", () => {
  const edit = {
    description: "Weekly shop", amount: 1234.56, type: "expense", date: "2026-07-02",
  };

  async function signIn() {
    const user = await seedUser();
    userId = user.id;
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;
    return user;
  }

  it("returns 401 when not signed in", async () => {
    const res = await PATCH(makeRequest({ method: "PATCH", body: {} }), params("nonexistent"));
    expect(res.status).toBe(401);
  });

  it("rejects requests with no CSRF token", async () => {
    await signIn();
    const res = await PATCH(makeRequest({ method: "PATCH", body: edit }), params("nonexistent"));
    expect(res.status).toBe(403);
  });

  it("returns field errors for invalid input", async () => {
    await signIn();
    const req = makeRequest({ method: "PATCH", csrfToken: "csrf", body: { ...edit, amount: -1 } });
    const res = await PATCH(req, params("nonexistent"));
    expect(res.status).toBe(400);
    expect((await res.json()).error.fieldErrors.amount).toBeTruthy();
  });

  it("updates the editable fields and keeps what the import set", async () => {
    const user = await signIn();
    const groceries = await seedCategory(user.id, { name: "Groceries" });
    const dining = await seedCategory(user.id, { name: "Dining" });
    const account = await prisma.account.create({
      data: { userId: user.id, name: "Everyday Checking", type: "cash", balance: 0 },
    });
    const tx = await prisma.transaction.create({
      data: {
        userId: user.id, categoryId: groceries.id, accountId: account.id,
        description: "FRESHGROCER 4021", merchant: "Fresh Grocer", notes: "split with roommate",
        amount: 84.5, type: "expense", date: new Date("2026-07-01"), externalHash: "imp-tx-9001",
      },
    });

    const req = makeRequest({
      method: "PATCH", csrfToken: "csrf", body: { ...edit, categoryId: dining.id },
    });
    const res = await PATCH(req, params(tx.id));
    expect(res.status).toBe(200);
    expect((await res.json()).data.transaction).toMatchObject({
      id: tx.id, description: "Weekly shop", amount: 1234.56, categoryId: dining.id,
      type: "expense", date: "2026-07-02",
    });

    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(row.description).toBe("Weekly shop");
    expect(row.amount.toNumber()).toBe(1234.56);
    expect(row.categoryId).toBe(dining.id);
    expect(row.date.toISOString().slice(0, 10)).toBe("2026-07-02");
    // A re-import dedups on externalHash, so it has to outlive the edit or
    // the import would add the original row back.
    expect(row.externalHash).toBe("imp-tx-9001");
    expect(row.accountId).toBe(account.id);
    expect(row.merchant).toBe("Fresh Grocer");
    expect(row.notes).toBe("split with roommate");
  });

  it("returns 404 and changes nothing when the transaction belongs to another user", async () => {
    await signIn();
    const other = await seedUser();
    otherUserId = other.id;
    const theirCategory = await seedCategory(other.id);
    const tx = await prisma.transaction.create({
      data: { userId: other.id, categoryId: theirCategory.id, description: "Not mine", amount: 10, type: "expense", date: new Date("2026-07-01") },
    });

    const req = makeRequest({
      method: "PATCH", csrfToken: "csrf", body: { ...edit, categoryId: theirCategory.id },
    });
    const res = await PATCH(req, params(tx.id));
    expect(res.status).toBe(404);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } })).description).toBe("Not mine");
  });

  it("refuses to file the caller's transaction under another user's category", async () => {
    const user = await signIn();
    const mine = await seedCategory(user.id);
    const other = await seedUser();
    otherUserId = other.id;
    const theirs = await seedCategory(other.id);
    const tx = await prisma.transaction.create({
      data: { userId: user.id, categoryId: mine.id, description: "Mine", amount: 10, type: "expense", date: new Date("2026-07-01") },
    });

    const req = makeRequest({ method: "PATCH", csrfToken: "csrf", body: { ...edit, categoryId: theirs.id } });
    const res = await PATCH(req, params(tx.id));
    expect(res.status).toBe(400);
    expect((await res.json()).error.fieldErrors.categoryId).toBeTruthy();
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } })).categoryId).toBe(mine.id);
  });

  // Create refuses an archived category. A row already filed under one must
  // still be editable, or a typo in its description could never be fixed.
  it("allows saving a transaction that keeps its archived category", async () => {
    const user = await signIn();
    const archived = await prisma.category.create({
      data: { userId: user.id, name: "Old Category", type: "expense", color: "bg-green-500", archivedAt: new Date() },
    });
    const tx = await prisma.transaction.create({
      data: { userId: user.id, categoryId: archived.id, description: "Typo", amount: 10, type: "expense", date: new Date("2026-07-01") },
    });

    const req = makeRequest({ method: "PATCH", csrfToken: "csrf", body: { ...edit, categoryId: archived.id } });
    const res = await PATCH(req, params(tx.id));
    expect(res.status).toBe(200);
  });

  it("refuses to move a transaction into an archived category", async () => {
    const user = await signIn();
    const active = await seedCategory(user.id);
    const archived = await prisma.category.create({
      data: { userId: user.id, name: "Old Category", type: "expense", color: "bg-green-500", archivedAt: new Date() },
    });
    const tx = await prisma.transaction.create({
      data: { userId: user.id, categoryId: active.id, description: "Mine", amount: 10, type: "expense", date: new Date("2026-07-01") },
    });

    const req = makeRequest({ method: "PATCH", csrfToken: "csrf", body: { ...edit, categoryId: archived.id } });
    const res = await PATCH(req, params(tx.id));
    expect(res.status).toBe(400);
  });
});
