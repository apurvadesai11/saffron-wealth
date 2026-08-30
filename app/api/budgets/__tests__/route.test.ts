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

import { PUT } from "../route";
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

describe("PUT /api/budgets", () => {
  it("returns 401 when not signed in", async () => {
    const req = makeRequest({ method: "PUT", body: {} });
    const res = await PUT(req);
    expect(res.status).toBe(401);
  });

  it("rejects requests with no CSRF token", async () => {
    const user = await seedUser();
    userId = user.id;
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const req = makeRequest({ method: "PUT", body: { entries: [] } });
    const res = await PUT(req);
    expect(res.status).toBe(403);
  });

  it("rejects an empty entries array", async () => {
    const user = await seedUser();
    userId = user.id;
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const req = makeRequest({ method: "PUT", csrfToken: "csrf", body: { entries: [] } });
    const res = await PUT(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when an entry's categoryId belongs to another user", async () => {
    const me = await seedUser();
    userId = me.id;
    const other = await seedUser();
    otherUserId = other.id;
    const otherCategory = await seedCategory(other.id);
    const { rawToken } = await seedSession(me.id);
    mocks.sessionToken = rawToken;

    const req = makeRequest({
      method: "PUT",
      csrfToken: "csrf",
      body: { entries: [{ categoryId: otherCategory.id, amount: 500, period: "monthly" }] },
    });
    const res = await PUT(req);
    expect(res.status).toBe(400);
  });

  it("saves a single budget (manual edit) and returns the full list", async () => {
    const user = await seedUser();
    userId = user.id;
    const category = await seedCategory(user.id, { name: "Housing" });
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const req = makeRequest({
      method: "PUT",
      csrfToken: "csrf",
      body: { entries: [{ categoryId: category.id, amount: 1600, period: "monthly" }] },
    });
    const res = await PUT(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.budgets).toEqual([{ categoryId: category.id, amount: 1600, period: "monthly" }]);
  });

  it("upserts many budgets at once (Auto-Set All) in a single call", async () => {
    const user = await seedUser();
    userId = user.id;
    const cat1 = await seedCategory(user.id, { name: "Housing" });
    const cat2 = await seedCategory(user.id, { name: "Groceries" });
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const req = makeRequest({
      method: "PUT",
      csrfToken: "csrf",
      body: {
        entries: [
          { categoryId: cat1.id, amount: 1600, period: "monthly" },
          { categoryId: cat2.id, amount: 400, period: "monthly" },
        ],
      },
    });
    const res = await PUT(req);
    expect(res.status).toBe(200);
    expect((await res.json()).data.budgets).toHaveLength(2);
  });

  it("a second save for the same category+period updates the existing row rather than duplicating it", async () => {
    const user = await seedUser();
    userId = user.id;
    const category = await seedCategory(user.id);
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    await PUT(makeRequest({
      method: "PUT", csrfToken: "csrf",
      body: { entries: [{ categoryId: category.id, amount: 400, period: "monthly" }] },
    }));
    const res2 = await PUT(makeRequest({
      method: "PUT", csrfToken: "csrf",
      body: { entries: [{ categoryId: category.id, amount: 550, period: "monthly" }] },
    }));
    expect((await res2.json()).data.budgets).toEqual([{ categoryId: category.id, amount: 550, period: "monthly" }]);

    const rows = await prisma.budget.findMany({ where: { userId: user.id, categoryId: category.id } });
    expect(rows).toHaveLength(1);
  });

  it("allows a $0 budget (hidden-from-budgets sentinel)", async () => {
    const user = await seedUser();
    userId = user.id;
    const category = await seedCategory(user.id);
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const req = makeRequest({
      method: "PUT", csrfToken: "csrf",
      body: { entries: [{ categoryId: category.id, amount: 0, period: "monthly" }] },
    });
    const res = await PUT(req);
    expect(res.status).toBe(200);
    expect((await res.json()).data.budgets[0].amount).toBe(0);
  });
});
