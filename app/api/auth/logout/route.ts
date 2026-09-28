import { NextResponse, type NextRequest } from "next/server";
import { revokeSession } from "@/lib/auth/sessions";
import { clearSessionCookie } from "@/lib/auth/session-cookie";
import { SESSION_COOKIE_NAME } from "@/lib/auth/server";
import { recordAuthEvent } from "@/lib/auth/audit-log";
import { validateCsrfFromRequest } from "@/lib/auth/csrf";
import { clientIp, userAgent } from "@/lib/auth/request-info";
import { err, internalError } from "@/lib/api/errors";

export async function POST(req: NextRequest) {
  try {
    if (!validateCsrfFromRequest(req)) {
      return err("CSRF_FAILED", "Invalid request.", 403);
    }

    const raw = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (raw) {
      await revokeSession(raw);
      await recordAuthEvent({
        type: "session_revoked",
        ipAddress: clientIp(req),
        userAgent: userAgent(req),
        metadata: { reason: "logout" },
      });
    }

    const res = NextResponse.json({ ok: true });
    clearSessionCookie(res);
    return res;
  } catch (e) {
    console.error("[api/auth/logout] unhandled error", e);
    return internalError();
  }
}
