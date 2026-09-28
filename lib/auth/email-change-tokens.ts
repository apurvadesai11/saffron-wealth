import { randomBytes, createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

// Matches PasswordResetToken's 15-minute TTL. An email-change link is the same
// kind of bearer credential arriving in the same channel, so it gets the same
// exposure window.
const TOKEN_TTL_MS = 15 * 60 * 1000;
const TOKEN_BYTES = 32;

export interface CreatedEmailChangeToken {
  rawToken: string; // emailed to the claimed address; never persisted
  expiresAt: Date;
}

export interface ValidEmailChangeTokenLookup {
  id: string;
  userId: string;
  newEmail: string;
  newEmailNormalized: string;
  expiresAt: Date;
}

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Issues a confirmation token for a pending email change.
 *
 * Any earlier unconsumed token for this user is invalidated first: if someone
 * changes their mind and requests a different address, the superseded link must
 * stop working, or the older claim could still be confirmed later.
 */
export async function createEmailChangeToken(
  userId: string,
  newEmail: string,
  newEmailNormalized: string,
): Promise<CreatedEmailChangeToken> {
  const rawToken = randomBytes(TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  await prisma.$transaction([
    prisma.emailChangeToken.updateMany({
      where: { userId, consumedAt: null },
      data: { consumedAt: new Date() },
    }),
    prisma.emailChangeToken.create({
      data: {
        userId,
        tokenHash: hashToken(rawToken),
        newEmail,
        newEmailNormalized,
        expiresAt,
      },
    }),
  ]);

  return { rawToken, expiresAt };
}

export async function findUsableEmailChangeToken(
  rawToken: string,
): Promise<ValidEmailChangeTokenLookup | null> {
  const row = await prisma.emailChangeToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: {
      id: true,
      userId: true,
      newEmail: true,
      newEmailNormalized: true,
      expiresAt: true,
      consumedAt: true,
    },
  });
  if (!row) return null;
  if (row.consumedAt !== null) return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;
  return {
    id: row.id,
    userId: row.userId,
    newEmail: row.newEmail,
    newEmailNormalized: row.newEmailNormalized,
    expiresAt: row.expiresAt,
  };
}

// Exposed for tests.
export const __internals = { hashToken, TOKEN_TTL_MS };
