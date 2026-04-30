import { randomBytes, createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

export const SESSION_TTL_DAYS = 30;
const LAST_SEEN_DEBOUNCE_MS = 60_000;

export interface CreatedSession {
  rawToken: string;
  expiresAt: Date;
}

export interface SessionWithUser {
  id: string;
  userId: string;
  expiresAt: Date;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    profilePicture: string | null;
  };
}

export function hashSessionToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

function makeRawToken(): string {
  return randomBytes(32).toString("base64url");
}

function ttlExpiresAt(): Date {
  return new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export async function createSession(
  userId: string,
  userAgent: string | null,
  ipAddress: string | null,
): Promise<CreatedSession> {
  const rawToken = makeRawToken();
  const expiresAt = ttlExpiresAt();
  await prisma.session.create({
    data: {
      tokenHash: hashSessionToken(rawToken),
      userId,
      expiresAt,
      userAgent,
      ipAddress,
    },
  });
  return { rawToken, expiresAt };
}

export async function readSession(
  rawToken: string,
): Promise<SessionWithUser | null> {
  const tokenHash = hashSessionToken(rawToken);
  const row = await prisma.session.findUnique({
    where: { tokenHash },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          profilePicture: true,
        },
      },
    },
  });
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id: row.id } }).catch(() => {});
    return null;
  }
  if (Date.now() - row.lastSeenAt.getTime() > LAST_SEEN_DEBOUNCE_MS) {
    await prisma.session
      .update({ where: { id: row.id }, data: { lastSeenAt: new Date() } })
      .catch(() => {});
  }
  return {
    id: row.id,
    userId: row.userId,
    expiresAt: row.expiresAt,
    user: row.user,
  };
}

export async function revokeSession(rawToken: string): Promise<void> {
  const tokenHash = hashSessionToken(rawToken);
  await prisma.session.deleteMany({ where: { tokenHash } });
}

export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}

export async function rotateSession(
  rawToken: string,
  userAgent: string | null,
  ipAddress: string | null,
): Promise<CreatedSession | null> {
  const tokenHash = hashSessionToken(rawToken);
  const existing = await prisma.session.findUnique({ where: { tokenHash } });
  if (!existing) return null;

  const newRaw = makeRawToken();
  const expiresAt = ttlExpiresAt();

  await prisma.$transaction([
    prisma.session.delete({ where: { id: existing.id } }),
    prisma.session.create({
      data: {
        tokenHash: hashSessionToken(newRaw),
        userId: existing.userId,
        expiresAt,
        userAgent,
        ipAddress,
      },
    }),
  ]);

  return { rawToken: newRaw, expiresAt };
}
