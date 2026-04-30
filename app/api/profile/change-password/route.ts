import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, SESSION_COOKIE_NAME } from "@/lib/auth/server";
import { validateCsrfFromRequest } from "@/lib/auth/csrf";
import { recordAuthEvent } from "@/lib/auth/audit-log";
import { clientIp, userAgent } from "@/lib/auth/request-info";
import {
  hashPassword,
  verifyPassword,
  validatePasswordRules,
} from "@/lib/auth/password";
import { isCommonPassword } from "@/lib/auth/blocklist";
import { checkPwnedPassword } from "@/lib/auth/hibp";
import { createSession } from "@/lib/auth/sessions";
import { setSessionCookie } from "@/lib/auth/session-cookie";

function err(code: string, message: string, status: number) {
  return NextResponse.json(
    { ok: false, error: { code, message } },
    { status },
  );
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return err("UNAUTHENTICATED", "Not signed in.", 401);
  if (!validateCsrfFromRequest(req)) return err("CSRF_FAILED", "Invalid request.", 403);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return err("BAD_REQUEST", "Invalid JSON body.", 400);
  }
  const b = body as Record<string, unknown>;
  const currentPassword = typeof b.currentPassword === "string" ? b.currentPassword : "";
  const newPassword = typeof b.newPassword === "string" ? b.newPassword : "";
  if (!currentPassword || !newPassword) {
    return err("BAD_REQUEST", "Missing currentPassword or newPassword.", 400);
  }

  const ip = clientIp(req);
  const ua = userAgent(req);

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, passwordHash: true },
  });
  if (!user) return err("UNAUTHENTICATED", "Not signed in.", 401);

  // Google-only users (no passwordHash) cannot change a password they don't
  // have. Tell them clearly.
  if (!user.passwordHash) {
    return err(
      "NO_PASSWORD_SET",
      "This account uses Google sign-in and has no password to change.",
      400,
    );
  }

  const verified = await verifyPassword(currentPassword, user.passwordHash);
  if (!verified) {
    await recordAuthEvent({
      type: "login_failure",
      userId: user.id,
      ipAddress: ip,
      userAgent: ua,
      metadata: { reason: "change_password_current_mismatch" },
    });
    return err("INVALID_CURRENT_PASSWORD", "Current password is incorrect.", 400);
  }

  const ruleResult = validatePasswordRules(newPassword);
  if (!ruleResult.ok) {
    return err("VALIDATION_FAILED", ruleResult.errors[0], 400);
  }
  if (isCommonPassword(newPassword)) {
    return err(
      "PASSWORD_TOO_COMMON",
      "That password is too common. Pick a more unique one.",
      400,
    );
  }
  const hibp = await checkPwnedPassword(newPassword);
  if (hibp.unavailable) {
    await recordAuthEvent({ type: "hibp_unavailable", userId: user.id, ipAddress: ip, userAgent: ua });
  } else if (hibp.pwned) {
    return err(
      "PASSWORD_PWNED",
      "This password has appeared in a known data breach. Choose a different one.",
      400,
    );
  }

  const newHash = await hashPassword(newPassword);

  // Atomically: update hash, revoke ALL sessions (including current), clear
  // failed-login rows. Forces re-login on every device but the current one
  // (we issue a fresh session for it below).
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash },
    }),
    prisma.session.deleteMany({ where: { userId: user.id } }),
    prisma.failedLogin.deleteMany({ where: { userId: user.id } }),
  ]);

  await Promise.all([
    recordAuthEvent({
      type: "password_change",
      userId: user.id,
      ipAddress: ip,
      userAgent: ua,
    }),
    recordAuthEvent({
      type: "session_revoked",
      userId: user.id,
      ipAddress: ip,
      userAgent: ua,
      metadata: { reason: "password_change" },
    }),
  ]);

  // Issue a fresh session for the current device so the user isn't
  // immediately bounced to /login.
  const fresh = await createSession(user.id, ua, ip);
  const res = NextResponse.json({
    ok: true,
    data: { message: "Password updated. Other devices have been signed out." },
  });
  setSessionCookie(res, fresh.rawToken, fresh.expiresAt);
  // Touch SESSION_COOKIE_NAME usage so TS doesn't whine on unused import.
  void SESSION_COOKIE_NAME;
  return res;
}
