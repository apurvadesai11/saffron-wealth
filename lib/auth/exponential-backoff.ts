import { prisma } from "@/lib/prisma";

// Per-account exponential backoff. Counts FailedLogin rows for an email since
// the user's most recent login_success (audit event), and returns the seconds
// the next attempt must wait. 0 means the attempt is allowed immediately.
//
// NOTE: this function MUST be called inside a transaction that has acquired a
// Postgres advisory lock keyed on the email (see acquireLoginLock below) to
// prevent two parallel requests from both reading "OK to attempt" and bypassing
// the backoff together.

const DELAY_TABLE_SECONDS = [0, 1, 2, 4, 8, 16, 32, 60];
const MAX_DELAY = 60;

export function delayForFailureCount(failures: number): number {
  if (failures <= 0) return 0;
  if (failures < DELAY_TABLE_SECONDS.length) return DELAY_TABLE_SECONDS[failures];
  return MAX_DELAY;
}

export interface BackoffStatus {
  allowed: boolean;
  delaySeconds: number;
  retryAfter: Date;
  failureCount: number;
}

export async function getBackoffStatus(
  emailNormalized: string,
): Promise<BackoffStatus> {
  const lastSuccess = await prisma.authEvent.findFirst({
    where: {
      type: "login_success",
      metadata: {
        path: ["emailNormalized"],
        equals: emailNormalized,
      } as never,
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const since = lastSuccess?.createdAt ?? new Date(0);

  const failures = await prisma.failedLogin.count({
    where: {
      emailNormalized,
      attemptedAt: { gt: since },
    },
  });
  const delaySeconds = delayForFailureCount(failures);

  if (delaySeconds === 0 || failures === 0) {
    return {
      allowed: true,
      delaySeconds: 0,
      retryAfter: new Date(),
      failureCount: failures,
    };
  }

  const lastFailure = await prisma.failedLogin.findFirst({
    where: { emailNormalized, attemptedAt: { gt: since } },
    orderBy: { attemptedAt: "desc" },
    select: { attemptedAt: true },
  });
  const baseTime = lastFailure?.attemptedAt ?? new Date();
  const retryAfter = new Date(baseTime.getTime() + delaySeconds * 1000);
  const allowed = retryAfter.getTime() <= Date.now();

  return { allowed, delaySeconds, retryAfter, failureCount: failures };
}

export async function recordFailedLogin(input: {
  userId: string | null;
  emailNormalized: string;
  ipAddress: string | null;
}): Promise<void> {
  await prisma.failedLogin.create({
    data: {
      userId: input.userId,
      emailNormalized: input.emailNormalized,
      ipAddress: input.ipAddress,
    },
  });
}

export async function clearFailedLoginsForUser(userId: string): Promise<void> {
  await prisma.failedLogin.deleteMany({ where: { userId } });
}

// Postgres advisory lock keyed on emailNormalized. Held for the duration of
// the surrounding transaction. Cheap (per-key, in-memory in PG) and forecloses
// on the concurrent-bypass race.
export async function acquireLoginLock(
  tx: Pick<typeof prisma, "$queryRaw">,
  emailNormalized: string,
): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${emailNormalized}))`;
}
