import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/auth/rate-limit";
import { validateCsrfFromRequest } from "@/lib/auth/csrf";
import { recordAuthEvent } from "@/lib/auth/audit-log";
import { clientIp, userAgent } from "@/lib/auth/request-info";
import { hashPassword, validatePasswordRules } from "@/lib/auth/password";
import { isCommonPassword } from "@/lib/auth/blocklist";
import { checkPwnedPassword } from "@/lib/auth/hibp";
import {
  findUsableResetToken,
  consumeResetToken,
} from "@/lib/auth/reset-tokens";
import { revokeAllSessionsForUser } from "@/lib/auth/sessions";

interface ErrorBody {
  ok: false;
  error: { code: string; message: string };
}

function err(code: string, message: string, status: number) {
  return NextResponse.json<ErrorBody>(
    { ok: false, error: { code, message } },
    { status },
  );
}

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req);
    const ua = userAgent(req);

    const rl = await rateLimit("password-reset", ip ?? "unknown");
    if (!rl.ok) return err("RATE_LIMITED", "Too many requests.", 429);
    if (!validateCsrfFromRequest(req)) return err("CSRF_FAILED", "Invalid request.", 403);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return err("BAD_REQUEST", "Invalid JSON body.", 400);
    }

    const rawToken =
      typeof (body as { token?: unknown })?.token === "string"
        ? (body as { token: string }).token
        : "";
    const newPassword =
      typeof (body as { password?: unknown })?.password === "string"
        ? (body as { password: string }).password
        : "";

    if (!rawToken || !newPassword) {
      return err("BAD_REQUEST", "Missing token or password.", 400);
    }

    const token = await findUsableResetToken(rawToken);
    if (!token) {
      return err(
        "TOKEN_INVALID",
        "This reset link is no longer valid. Request a new one.",
        400,
      );
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
      await recordAuthEvent({ type: "hibp_unavailable", userId: token.userId, ipAddress: ip, userAgent: ua });
    } else if (hibp.pwned) {
      return err(
        "PASSWORD_PWNED",
        "This password has appeared in a known data breach. Choose a different one.",
        400,
      );
    }

    const passwordHash = await hashPassword(newPassword);

    // Atomically: update user's password, mark token consumed, revoke all
    // sessions for the user. Forces re-login on every device.
    await prisma.$transaction([
      prisma.user.update({
        where: { id: token.userId },
        data: { passwordHash },
      }),
      prisma.passwordResetToken.update({
        where: { id: token.id },
        data: { consumedAt: new Date() },
      }),
      prisma.session.deleteMany({ where: { userId: token.userId } }),
      prisma.failedLogin.deleteMany({ where: { userId: token.userId } }),
    ]);

    await Promise.all([
      recordAuthEvent({
        type: "password_reset_completed",
        userId: token.userId,
        ipAddress: ip,
        userAgent: ua,
      }),
      recordAuthEvent({
        type: "session_revoked",
        userId: token.userId,
        ipAddress: ip,
        userAgent: ua,
        metadata: { reason: "password_reset" },
      }),
    ]);

    // Defensive: ensure no sessions linger if the transaction-level revoke missed
    // anything (shouldn't, but cheap insurance).
    await revokeAllSessionsForUser(token.userId).catch(() => {});

    return NextResponse.json({
      ok: true,
      data: {
        message: "Password updated. Sign in with your new password.",
      },
    });
  } catch (e) {
    console.error("[api/auth/password-reset/confirm] unhandled error", e);
    return NextResponse.json(
      { ok: false, error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } },
      { status: 500 },
    );
  }
}

// We deliberately do NOT export consumeResetToken usage here — the
// transaction above writes consumedAt directly, single-source-of-truth.
void consumeResetToken;
