import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  createEmailChangeToken,
  findUsableEmailChangeToken,
  __internals,
} from "./email-change-tokens";

const createdUsers: string[] = [];

async function seedUser() {
  const email = `ect-${randomUUID()}@example.test`;
  const u = await prisma.user.create({
    data: { email, emailNormalized: email.toLowerCase(), firstName: "T", lastName: "T" },
  });
  createdUsers.push(u.id);
  return u;
}

afterEach(async () => {
  for (const id of createdUsers) {
    await prisma.user.delete({ where: { id } }).catch(() => {});
  }
  createdUsers.length = 0;
});

describe("createEmailChangeToken", () => {
  it("stores only the SHA-256 hash, never the raw token", async () => {
    const user = await seedUser();
    const { rawToken } = await createEmailChangeToken(
      user.id,
      "New@Example.test",
      "new@example.test",
    );

    const rows = await prisma.emailChangeToken.findMany({
      where: { userId: user.id },
      select: { tokenHash: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(__internals.hashToken(rawToken));
    expect(rows[0].tokenHash).not.toBe(rawToken);
  });

  it("keeps the claimed address in both raw and normalized form", async () => {
    const user = await seedUser();
    await createEmailChangeToken(user.id, "Mixed.Case@Example.test", "mixed.case@example.test");

    const row = await prisma.emailChangeToken.findFirst({
      where: { userId: user.id },
      select: { newEmail: true, newEmailNormalized: true },
    });
    expect(row?.newEmail).toBe("Mixed.Case@Example.test");
    expect(row?.newEmailNormalized).toBe("mixed.case@example.test");
  });

  it("expires 15 minutes out, matching password reset", async () => {
    const user = await seedUser();
    const before = Date.now();
    const { expiresAt } = await createEmailChangeToken(user.id, "a@b.test", "a@b.test");
    const ttl = expiresAt.getTime() - before;

    expect(__internals.TOKEN_TTL_MS).toBe(15 * 60 * 1000);
    expect(ttl).toBeGreaterThan(14 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(15 * 60 * 1000 + 5_000);
  });

  it("consumes any earlier unconsumed token for the same user", async () => {
    // A superseded claim must stop being confirmable, or an abandoned address
    // could still be applied later.
    const user = await seedUser();
    const first = await createEmailChangeToken(user.id, "first@b.test", "first@b.test");
    await createEmailChangeToken(user.id, "second@b.test", "second@b.test");

    expect(await findUsableEmailChangeToken(first.rawToken)).toBeNull();

    const live = await prisma.emailChangeToken.findMany({
      where: { userId: user.id, consumedAt: null },
      select: { newEmailNormalized: true },
    });
    expect(live).toHaveLength(1);
    expect(live[0].newEmailNormalized).toBe("second@b.test");
  });

  it("issues a different token every time", async () => {
    const user = await seedUser();
    const a = await createEmailChangeToken(user.id, "a@b.test", "a@b.test");
    const b = await createEmailChangeToken(user.id, "a@b.test", "a@b.test");
    expect(a.rawToken).not.toBe(b.rawToken);
  });
});

describe("findUsableEmailChangeToken", () => {
  it("returns the claim for a live token", async () => {
    const user = await seedUser();
    const { rawToken } = await createEmailChangeToken(
      user.id,
      "Claim@Example.test",
      "claim@example.test",
    );

    const found = await findUsableEmailChangeToken(rawToken);
    expect(found?.userId).toBe(user.id);
    expect(found?.newEmail).toBe("Claim@Example.test");
    expect(found?.newEmailNormalized).toBe("claim@example.test");
  });

  it("returns null for an unknown token", async () => {
    expect(await findUsableEmailChangeToken("no-such-token")).toBeNull();
  });

  it("returns null once consumed", async () => {
    const user = await seedUser();
    const { rawToken } = await createEmailChangeToken(user.id, "a@b.test", "a@b.test");
    await prisma.emailChangeToken.updateMany({
      where: { userId: user.id },
      data: { consumedAt: new Date() },
    });
    expect(await findUsableEmailChangeToken(rawToken)).toBeNull();
  });

  it("returns null once expired", async () => {
    const user = await seedUser();
    const { rawToken } = await createEmailChangeToken(user.id, "a@b.test", "a@b.test");
    await prisma.emailChangeToken.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    expect(await findUsableEmailChangeToken(rawToken)).toBeNull();
  });
});
