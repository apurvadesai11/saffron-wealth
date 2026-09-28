import { NextResponse } from "next/server";
import { revokeAllSessionsForUser } from "@/lib/auth/sessions";
import { clearSessionCookie } from "@/lib/auth/session-cookie";
import { recordAuthEvent } from "@/lib/auth/audit-log";
import { clientIp, userAgent } from "@/lib/auth/request-info";
import { withApiHandler } from "@/lib/api/handler";

export const POST = withApiHandler(
  { logLabel: "api/auth/logout-all", csrf: true },
  async ({ req, session }) => {
    await revokeAllSessionsForUser(session.user.id);
    await recordAuthEvent({
      type: "session_revoked",
      userId: session.user.id,
      ipAddress: clientIp(req),
      userAgent: userAgent(req),
      metadata: { reason: "logout_all" },
    });

    const res = NextResponse.json({ ok: true });
    clearSessionCookie(res);
    return res;
  },
);
