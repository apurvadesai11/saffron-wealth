import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/server";
import { validateCsrfFromRequest } from "@/lib/auth/csrf";
import { revokeAllSessionsForUser } from "@/lib/auth/sessions";
import { clearSessionCookie } from "@/lib/auth/session-cookie";
import { recordAuthEvent } from "@/lib/auth/audit-log";
import { clientIp, userAgent } from "@/lib/auth/request-info";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, error: { code: "UNAUTHENTICATED", message: "Not signed in." } },
      { status: 401 },
    );
  }
  if (!validateCsrfFromRequest(req)) {
    return NextResponse.json(
      { ok: false, error: { code: "CSRF_FAILED", message: "Invalid request." } },
      { status: 403 },
    );
  }

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
}
