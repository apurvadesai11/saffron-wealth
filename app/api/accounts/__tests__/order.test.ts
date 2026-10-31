import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { listAccounts } from "@/lib/accounts";

const mocks = vi.hoisted(() => ({ sessionToken: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      (name === "sw_session" || name === "__Host-sw_session") && mocks.sessionToken
        ? { value: mocks.sessionToken }
        : undefined,
  }),
}));

import { PUT } from "../order/route";
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

async function signIn() {
  const user = await seedUser();
  userId = user.id;
  const { rawToken } = await seedSession(user.id);
  mocks.sessionToken = rawToken;
  return user;
}

// Created a millisecond apart so createdAt alone gives a known starting order.
async function seedAccounts(ownerId: string, names: string[]) {
  const accounts = [];
  for (const [i, name] of names.entries()) {
    accounts.push(
      await prisma.account.create({
        data: { userId: ownerId, name, type: "cash", balance: 100, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 0, i)) },
      }),
    );
  }
  return accounts;
}

function put(body: unknown, csrfToken: string | null = "csrf") {
  return makeRequest({ method: "PUT", url: "http://localhost/api/accounts/order", csrfToken, body });
}

describe("PUT /api/accounts/order", () => {
  it("returns 401 when not signed in", async () => {
    const res = await PUT(put({ accountIds: ["a"] }));
    expect(res.status).toBe(401);
  });

  it("rejects requests with no CSRF token", async () => {
    await signIn();
    const res = await PUT(put({ accountIds: ["a"] }, null));
    expect(res.status).toBe(403);
  });

  it("returns field errors for an invalid body", async () => {
    await signIn();
    const res = await PUT(put({ accountIds: [] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.fieldErrors.accountIds).toBeTruthy();
  });

  it("saves the order, and the account list comes back in it", async () => {
    const user = await signIn();
    const [first, second, third] = await seedAccounts(user.id, ["First", "Second", "Third"]);
    expect((await listAccounts(user.id)).map((a) => a.name)).toEqual(["First", "Second", "Third"]);

    const res = await PUT(put({ accountIds: [third.id, first.id, second.id] }));

    expect(res.status).toBe(200);
    expect((await listAccounts(user.id)).map((a) => a.name)).toEqual(["Third", "First", "Second"]);
  });

  // Each section is reordered on its own, so a save names only that
  // section's accounts. The rest keep their places, and an account that has
  // never been placed (a new one) goes after the placed ones.
  it("orders unplaced accounts after placed ones, by when they were created", async () => {
    const user = await signIn();
    const [a, b, c] = await seedAccounts(user.id, ["A", "B", "C"]);

    await PUT(put({ accountIds: [c.id, a.id] }));

    expect((await listAccounts(user.id)).map((x) => x.id)).toEqual([c.id, a.id, b.id]);
  });

  it("refuses an order naming another user's account, and changes nothing", async () => {
    const user = await signIn();
    const [mine] = await seedAccounts(user.id, ["Mine"]);
    const other = await seedUser();
    otherUserId = other.id;
    const [theirs] = await seedAccounts(other.id, ["Theirs"]);

    const res = await PUT(put({ accountIds: [theirs.id, mine.id] }));

    expect(res.status).toBe(404);
    const rows = await prisma.account.findMany({ where: { id: { in: [mine.id, theirs.id] } } });
    expect(rows.map((r) => r.sortOrder)).toEqual([null, null]);
  });

  it("refuses an order naming an archived account", async () => {
    const user = await signIn();
    const [active, archived] = await seedAccounts(user.id, ["Active", "Archived"]);
    await prisma.account.update({ where: { id: archived.id }, data: { archivedAt: new Date() } });

    const res = await PUT(put({ accountIds: [archived.id, active.id] }));

    expect(res.status).toBe(404);
  });
});
