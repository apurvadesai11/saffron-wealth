import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

const { passwordResetToken } = vi.hoisted(() => ({
  passwordResetToken: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { passwordResetToken },
}));

import {
  createPasswordResetToken,
  findUsableResetToken,
  consumeResetToken,
  __internals,
} from "./reset-tokens";

beforeEach(() => {
  Object.values(passwordResetToken).forEach((fn) => fn.mockReset());
});

describe("createPasswordResetToken", () => {
  it("stores only the SHA-256 hash, never the raw token", async () => {
    passwordResetToken.create.mockResolvedValue(undefined);
    const result = await createPasswordResetToken("user_x");
    expect(result.rawToken).toMatch(/^[A-Za-z0-9_-]+$/);

    const data = passwordResetToken.create.mock.calls[0][0].data;
    expect(data.userId).toBe("user_x");
    expect(data.tokenHash).toBe(
      createHash("sha256").update(result.rawToken).digest("hex"),
    );
    expect(data.tokenHash).not.toBe(result.rawToken);
    expect(data.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(data.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(
      __internals.TOKEN_TTL_MS + 1000,
    );
  });
});

describe("findUsableResetToken", () => {
  it("returns null when token doesn't exist", async () => {
    passwordResetToken.findUnique.mockResolvedValue(null);
    expect(await findUsableResetToken("anything")).toBeNull();
  });

  it("returns null when token already consumed", async () => {
    passwordResetToken.findUnique.mockResolvedValue({
      id: "t1",
      userId: "u",
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: new Date(),
    });
    expect(await findUsableResetToken("raw")).toBeNull();
  });

  it("returns null when token expired", async () => {
    passwordResetToken.findUnique.mockResolvedValue({
      id: "t1",
      userId: "u",
      expiresAt: new Date(Date.now() - 1000),
      consumedAt: null,
    });
    expect(await findUsableResetToken("raw")).toBeNull();
  });

  it("returns the lookup when valid", async () => {
    passwordResetToken.findUnique.mockResolvedValue({
      id: "t1",
      userId: "u_42",
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    });
    const result = await findUsableResetToken("raw");
    expect(result).not.toBeNull();
    expect(result!.userId).toBe("u_42");
  });

  it("looks up by SHA-256 hash, not raw token", async () => {
    passwordResetToken.findUnique.mockResolvedValue(null);
    await findUsableResetToken("the-real-token");
    const where = passwordResetToken.findUnique.mock.calls[0][0].where;
    expect(where.tokenHash).toBe(
      createHash("sha256").update("the-real-token").digest("hex"),
    );
    expect(where.tokenHash).not.toBe("the-real-token");
  });
});

describe("consumeResetToken", () => {
  it("sets consumedAt", async () => {
    passwordResetToken.update.mockResolvedValue(undefined);
    await consumeResetToken("t1");
    const args = passwordResetToken.update.mock.calls[0][0];
    expect(args.where).toEqual({ id: "t1" });
    expect(args.data.consumedAt).toBeInstanceOf(Date);
  });
});
