import { prisma } from "@/lib/prisma";
import type { AuthEventType } from "@/lib/types";

export interface AuthEventInput {
  type: AuthEventType;
  userId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}

// Record an auth event. Never throws — an audit-write failure must NOT break
// the surrounding auth flow. We log to console and continue.
export async function recordAuthEvent(input: AuthEventInput): Promise<void> {
  try {
    await prisma.authEvent.create({
      data: {
        type: input.type,
        userId: input.userId ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        metadata: (input.metadata ?? null) as never,
      },
    });
  } catch (err) {
     
    console.error("[audit-log] failed to record event", input.type, err);
  }
}
