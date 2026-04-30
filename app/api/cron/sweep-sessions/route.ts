import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

// Removes expired sessions and consumed/expired password-reset tokens.
// Triggered by Vercel Cron (see vercel.json). Protected by CRON_SECRET so it
// can't be hit by unauthenticated traffic.
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

  const now = new Date();
  const [sessions, resetTokens] = await Promise.all([
    prisma.session.deleteMany({ where: { expiresAt: { lte: now } } }),
    prisma.passwordResetToken.deleteMany({
      where: {
        OR: [
          { expiresAt: { lte: now } },
          {
            consumedAt: {
              lte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
            },
          },
        ],
      },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    data: {
      deletedSessions: sessions.count,
      deletedResetTokens: resetTokens.count,
    },
  });
}
