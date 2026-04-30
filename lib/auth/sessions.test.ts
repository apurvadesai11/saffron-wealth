import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

const { session, $transaction } = vi.hoisted(() => ({
  session: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    session,
    $transaction,
  },
}));

import {
  createSession,
  readSession,
  revokeSession,
  revokeAllSessionsForUser,
  rotateSession,
  hashSessionToken,
} from "./sessions";

const dummyUser = {
  id: "user_1",
  email: "user@example.com",
  firstName: "First",
  lastName: "Last",
  profilePicture: null,
};

beforeEach(() => {
  Object.values(session).forEach((fn) => fn.mockReset());
  $transaction.mockReset();
});

describe("createSession", () => {
  it("stores a SHA-256 hash of the raw token, never the raw token itself", async () => {
    session.create.mockResolvedValue(undefined);
    const result = await createSession("user_1", "ua", "1.2.3.4");
    expect(result.rawToken).toMatch(/^[A-Za-z0-9_-]+$/);

    const callArg = session.create.mock.calls[0][0].data;
    expect(callArg.tokenHash).toBe(
      createHash("sha256").update(result.rawToken).digest("hex"),
    );
    expect(callArg.tokenHash).not.toBe(result.rawToken);
    expect(callArg.userId).toBe("user_1");
    expect(callArg.userAgent).toBe("ua");
    expect(callArg.ipAddress).toBe("1.2.3.4");
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("readSession", () => {
  it("returns null when no row matches", async () => {
    session.findUnique.mockResolvedValue(null);
    expect(await readSession("anything")).toBeNull();
  });

  it("returns null and deletes row when expired", async () => {
    const expired = new Date(Date.now() - 1000);
    session.findUnique.mockResolvedValue({
      id: "s1",
      userId: "user_1",
      expiresAt: expired,
      lastSeenAt: new Date(),
      user: dummyUser,
    });
    session.delete.mockResolvedValue(undefined);
    expect(await readSession("raw")).toBeNull();
    expect(session.delete).toHaveBeenCalledWith({ where: { id: "s1" } });
  });

  it("returns user when valid and unexpired", async () => {
    const future = new Date(Date.now() + 60_000);
    session.findUnique.mockResolvedValue({
      id: "s2",
      userId: "user_1",
      expiresAt: future,
      lastSeenAt: new Date(),
      user: dummyUser,
    });
    const result = await readSession("raw");
    expect(result).not.toBeNull();
    expect(result!.user.email).toBe("user@example.com");
  });

  it("looks up by tokenHash, never by raw token", async () => {
    session.findUnique.mockResolvedValue(null);
    await readSession("the-raw-token");
    const where = session.findUnique.mock.calls[0][0].where;
    expect(where.tokenHash).toBe(
      createHash("sha256").update("the-raw-token").digest("hex"),
    );
    expect(where.tokenHash).not.toBe("the-raw-token");
  });
});

describe("revokeSession", () => {
  it("deletes by tokenHash", async () => {
    session.deleteMany.mockResolvedValue({ count: 1 });
    await revokeSession("raw");
    const where = session.deleteMany.mock.calls[0][0].where;
    expect(where.tokenHash).toBe(
      createHash("sha256").update("raw").digest("hex"),
    );
  });
});

describe("revokeAllSessionsForUser", () => {
  it("deletes every session for the user id", async () => {
    session.deleteMany.mockResolvedValue({ count: 3 });
    await revokeAllSessionsForUser("user_42");
    expect(session.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user_42" },
    });
  });
});

describe("rotateSession", () => {
  it("returns null when no existing session matches", async () => {
    session.findUnique.mockResolvedValue(null);
    expect(await rotateSession("raw", null, null)).toBeNull();
  });

  it("creates a fresh token and deletes the old row in one transaction", async () => {
    session.findUnique.mockResolvedValue({
      id: "s_old",
      userId: "user_1",
    });
    $transaction.mockResolvedValue(undefined);
    const result = await rotateSession("old-raw", "ua", "ip");
    expect(result).not.toBeNull();
    expect(result!.rawToken).not.toBe("old-raw");
    expect($transaction).toHaveBeenCalledOnce();
  });
});

describe("hashSessionToken", () => {
  it("is deterministic", () => {
    expect(hashSessionToken("x")).toBe(hashSessionToken("x"));
    expect(hashSessionToken("x")).not.toBe(hashSessionToken("y"));
  });
});
