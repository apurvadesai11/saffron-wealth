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

import { DELETE } from "../[id]/route";
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
