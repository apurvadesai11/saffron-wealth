import { randomBytes, createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
const TOKEN_BYTES = 32;

export interface CreatedResetToken {
  rawToken: string; // emailed to the user; never persisted
  expiresAt: Date;
}

export interface ValidResetTokenLookup {
  id: string;
  userId: string;
  expiresAt: Date;
}

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export async function createPasswordResetToken(
  userId: string,
): Promise<CreatedResetToken> {
  const rawToken = randomBytes(TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  await prisma.passwordResetToken.create({
    data: {
      userId,
      tokenHash: hashToken(rawToken),
      expiresAt,
    },
  });
  return { rawToken, expiresAt };
}

export async function findUsableResetToken(
  rawToken: string,
): Promise<ValidResetTokenLookup | null> {
  const tokenHash = hashToken(rawToken);
  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      consumedAt: true,
    },
  });
  if (!row) return null;
  if (row.consumedAt !== null) return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;
  return { id: row.id, userId: row.userId, expiresAt: row.expiresAt };
}

export async function consumeResetToken(tokenId: string): Promise<void> {
  await prisma.passwordResetToken.update({
    where: { id: tokenId },
    data: { consumedAt: new Date() },
  });
}

// Exposed for tests.
export const __internals = { hashToken, TOKEN_TTL_MS };
