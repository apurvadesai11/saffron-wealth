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
import { seedUser, seedSession, makeRequest, cleanupUser } from "./helpers";

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

describe("PATCH /api/accounts/[id]", () => {
  it("returns 401 when not signed in", async () => {
    const req = makeRequest({ method: "PATCH", body: {} });
    const res = await PATCH(req, params("nonexistent"));
    expect(res.status).toBe(401);
  });

  it("rejects requests with no CSRF token", async () => {
    const user = await seedUser();
    userId = user.id;
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const req = makeRequest({ method: "PATCH", body: { balance: 100 } });
    const res = await PATCH(req, params("nonexistent"));
    expect(res.status).toBe(403);
  });

  it("returns field errors for invalid input", async () => {
    const user = await seedUser();
    userId = user.id;
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const req = makeRequest({ method: "PATCH", csrfToken: "csrf", body: { balance: -1, type: "bogus" } });
    const res = await PATCH(req, params("nonexistent"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  it("returns 404 when the account belongs to another user", async () => {
    const me = await seedUser();
    userId = me.id;
    const other = await seedUser();
    otherUserId = other.id;
    const otherAccount = await prisma.account.create({
      data: { userId: other.id, name: "Not mine", type: "cash", balance: 100 },
    });

    const { rawToken } = await seedSession(me.id);
    mocks.sessionToken = rawToken;

    const req = makeRequest({ method: "PATCH", csrfToken: "csrf", body: { balance: 999 } });
    const res = await PATCH(req, params(otherAccount.id));
    expect(res.status).toBe(404);
  });

  it("renaming an account (name-only patch) does not append balance history", async () => {
    const user = await seedUser();
    userId = user.id;
    const account = await prisma.account.create({
      data: { userId: user.id, name: "Old Name", type: "cash", balance: 100 },
    });
    await prisma.accountBalanceEvent.create({
      data: { userId: user.id, accountId: account.id, balance: 100 },
    });
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const req = makeRequest({ method: "PATCH", csrfToken: "csrf", body: { name: "New Name" } });
    const res = await PATCH(req, params(account.id));
    expect(res.status).toBe(200);
    expect((await res.json()).data.account.name).toBe("New Name");

    const events = await prisma.accountBalanceEvent.findMany({ where: { accountId: account.id } });
    expect(events).toHaveLength(1);
  });

  it("changing the balance appends exactly one new history event", async () => {
    const user = await seedUser();
    userId = user.id;
    const account = await prisma.account.create({
      data: { userId: user.id, name: "Brokerage", type: "brokerage", balance: 1000 },
    });
    await prisma.accountBalanceEvent.create({
      data: { userId: user.id, accountId: account.id, balance: 1000 },
    });
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const req = makeRequest({ method: "PATCH", csrfToken: "csrf", body: { balance: 1500 } });
    const res = await PATCH(req, params(account.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.account.balance).toBe(1500);

    const events = await prisma.accountBalanceEvent.findMany({
      where: { accountId: account.id },
      orderBy: { recordedAt: "asc" },
    });
    expect(events).toHaveLength(2);
    expect(events[1].balance.toNumber()).toBe(1500);
  });

  it("allows changing the account type, including flipping asset/liability", async () => {
    const user = await seedUser();
    userId = user.id;
    const account = await prisma.account.create({
      data: { userId: user.id, name: "Was Cash", type: "cash", balance: 500 },
    });
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const req = makeRequest({ method: "PATCH", csrfToken: "csrf", body: { type: "credit_card" } });
    const res = await PATCH(req, params(account.id));
    expect(res.status).toBe(200);
    expect((await res.json()).data.account.type).toBe("credit_card");
  });

  // Restore round trip (Phase 3, Task 8): archive → PATCH {archivedAt: null}
  // clears it. This is the only PATCH shape allowed to touch an already-
  // archived row — every other PATCH in this file targets an active one.
  it("restores an archived account by PATCHing archivedAt: null", async () => {
    const user = await seedUser();
    userId = user.id;
    const account = await prisma.account.create({
      data: { userId: user.id, name: "Closed by import", type: "brokerage", balance: 5000, archivedAt: new Date() },
    });
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const req = makeRequest({ method: "PATCH", csrfToken: "csrf", body: { archivedAt: null } });
    const res = await PATCH(req, params(account.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.account.id).toBe(account.id);

    const row = await prisma.account.findUnique({ where: { id: account.id } });
    expect(row?.archivedAt).toBeNull();
  });

  it("returns 404 restoring an account that isn't archived (nothing to restore)", async () => {
    const user = await seedUser();
    userId = user.id;
    const account = await prisma.account.create({
      data: { userId: user.id, name: "Already active", type: "cash", balance: 100 },
    });
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const req = makeRequest({ method: "PATCH", csrfToken: "csrf", body: { archivedAt: null } });
    const res = await PATCH(req, params(account.id));
    expect(res.status).toBe(404);
  });

  it("rejects a PATCH that tries to set archivedAt to a non-null value (archiving stays DELETE-only)", async () => {
    const user = await seedUser();
    userId = user.id;
    const account = await prisma.account.create({
      data: { userId: user.id, name: "Cannot archive via PATCH", type: "cash", balance: 100 },
    });
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const req = makeRequest({
      method: "PATCH",
      csrfToken: "csrf",
      body: { archivedAt: "2026-01-01T00:00:00.000Z" },
    });
    const res = await PATCH(req, params(account.id));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_FAILED");

    const row = await prisma.account.findUnique({ where: { id: account.id } });
    expect(row?.archivedAt).toBeNull();
  });

  it("restoring another user's archived account returns 404", async () => {
    const me = await seedUser();
    userId = me.id;
    const other = await seedUser();
    otherUserId = other.id;
    const otherAccount = await prisma.account.create({
      data: { userId: other.id, name: "Not mine", type: "cash", balance: 100, archivedAt: new Date() },
    });
    const { rawToken } = await seedSession(me.id);
    mocks.sessionToken = rawToken;

    const req = makeRequest({ method: "PATCH", csrfToken: "csrf", body: { archivedAt: null } });
    const res = await PATCH(req, params(otherAccount.id));
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/accounts/[id]", () => {
  it("returns 401 when not signed in", async () => {
    const req = makeRequest({ method: "DELETE" });
    const res = await DELETE(req, params("nonexistent"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when the account belongs to another user", async () => {
    const me = await seedUser();
    userId = me.id;
    const other = await seedUser();
    otherUserId = other.id;
    const otherAccount = await prisma.account.create({
      data: { userId: other.id, name: "Not mine", type: "cash", balance: 100 },
    });
    const { rawToken } = await seedSession(me.id);
    mocks.sessionToken = rawToken;

    const req = makeRequest({ method: "DELETE", csrfToken: "csrf" });
    const res = await DELETE(req, params(otherAccount.id));
    expect(res.status).toBe(404);
  });

  it("soft-deletes: the account disappears from the row but its data and history remain", async () => {
    const user = await seedUser();
    userId = user.id;
    const account = await prisma.account.create({
      data: { userId: user.id, name: "To Delete", type: "cash", balance: 250 },
    });
    await prisma.accountBalanceEvent.create({
      data: { userId: user.id, accountId: account.id, balance: 250 },
    });
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const req = makeRequest({ method: "DELETE", csrfToken: "csrf" });
    const res = await DELETE(req, params(account.id));
    expect(res.status).toBe(200);

    const row = await prisma.account.findUnique({ where: { id: account.id } });
    expect(row).not.toBeNull();
    expect(row?.archivedAt).not.toBeNull();

    const events = await prisma.accountBalanceEvent.findMany({ where: { accountId: account.id } });
    expect(events).toHaveLength(1);
  });

  it("a second delete on an already-archived account returns 404", async () => {
    const user = await seedUser();
    userId = user.id;
    const account = await prisma.account.create({
      data: { userId: user.id, name: "Twice", type: "cash", balance: 1, archivedAt: new Date() },
    });
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const req = makeRequest({ method: "DELETE", csrfToken: "csrf" });
    const res = await DELETE(req, params(account.id));
    expect(res.status).toBe(404);
  });
});
