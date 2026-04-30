import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

// Audit-log retention. Default policy: 365 days. Triggered by Vercel Cron.
// Adjust AUDIT_RETENTION_DAYS via env if compliance dictates a different
// window.
const DEFAULT_RETENTION_DAYS = 365;

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  const provided = authHeader?.replace(/^Bearer\s+/i, "");
  if (!expected || provided !== expected) {
    return NextResponse.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "Bad cron secret." } },
      { status: 401 },
    );
  }

  const days = Number(process.env.AUDIT_RETENTION_DAYS ?? DEFAULT_RETENTION_DAYS);
  if (!Number.isFinite(days) || days < 30) {
    return NextResponse.json(
      { ok: false, error: { code: "MISCONFIGURED", message: "AUDIT_RETENTION_DAYS must be >= 30." } },
      { status: 500 },
    );
  }
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [authEvents, failedLogins] = await Promise.all([
    prisma.authEvent.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    prisma.failedLogin.deleteMany({
      where: { attemptedAt: { lt: cutoff } },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    data: {
      retentionDays: days,
      deletedAuthEvents: authEvents.count,
      deletedFailedLogins: failedLogins.count,
    },
  });
}
