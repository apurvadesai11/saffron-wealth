import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateCsrfFromRequest } from "@/lib/auth/csrf";
import { recordAuthEvent } from "@/lib/auth/audit-log";
import { clientIp, userAgent } from "@/lib/auth/request-info";
import { rateLimit } from "@/lib/auth/rate-limit";
import { findUsableEmailChangeToken } from "@/lib/auth/email-change-tokens";
import { createSession } from "@/lib/auth/sessions";
import { setSessionCookie } from "@/lib/auth/session-cookie";

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

// Deliberately identical for "no such token", "already used" and "expired" —
// distinguishing them would tell a holder of a guessed token which guesses are
// close. Mirrors password-reset/confirm.
const INVALID_TOKEN = () =>
  err("INVALID_TOKEN", "This link is invalid or has expired.", 400);

/**
 * Applies a pending email change.
 *
 * Reachable without a session on purpose: the link is confirmed from whatever
 * device reads the new inbox, which may not be the one that requested it. The
 * token is the credential.
 */
export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req);
    const ua = userAgent(req);

    const rl = await rateLimit("email-change-confirm", ip ?? "unknown");
    if (!rl.ok) {
      return err("RATE_LIMITED", "Too many requests. Try again shortly.", 429);
    }
    if (!validateCsrfFromRequest(req)) {
      return err("CSRF_FAILED", "Invalid request.", 403);
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return err("BAD_REQUEST", "Invalid JSON body.", 400);
    }
    if (typeof body !== "object" || body === null) {
      return err("BAD_REQUEST", "Invalid body.", 400);
    }
    const token = (body as Record<string, unknown>).token;
    if (typeof token !== "string" || token.length === 0) {
      return INVALID_TOKEN();
    }

    const found = await findUsableEmailChangeToken(token);
    if (!found) return INVALID_TOKEN();

    const user = await prisma.user.findUnique({
      where: { id: found.userId },
      select: { id: true, emailNormalized: true },
    });
    if (!user) return INVALID_TOKEN();

    // Re-check uniqueness HERE, not just at request time. The link may have
    // sat in an inbox for minutes while another user registered or confirmed
    // the same address; the request-time check is stale by now.
    const taken = await prisma.user.findUnique({
      where: { emailNormalized: found.newEmailNormalized },
      select: { id: true },
    });
    if (taken && taken.id !== found.userId) {
      // Burn the token: the claim can never succeed, and leaving it usable
      // invites retries against a moving target.
      await prisma.emailChangeToken.update({
        where: { id: found.id },
        data: { consumedAt: new Date() },
      });
      return err(
        "EMAIL_EXISTS",
        "An account with that email already exists. The change was not applied.",
        409,
      );
    }

    // Atomically: apply the address, consume the token, revoke every session.
    // Revoking matters because the address is the account's recovery channel —
    // if this change was made by someone else, their sessions die with it.
    await prisma.$transaction([
      prisma.user.update({
        where: { id: found.userId },
        data: {
          email: found.newEmail,
          emailNormalized: found.newEmailNormalized,
        },
      }),
      prisma.emailChangeToken.update({
        where: { id: found.id },
        data: { consumedAt: new Date() },
      }),
      prisma.session.deleteMany({ where: { userId: found.userId } }),
    ]);

    await Promise.all([
      recordAuthEvent({
        type: "email_change",
        userId: found.userId,
        ipAddress: ip,
        userAgent: ua,
        metadata: {
          previousEmailNormalized: user.emailNormalized,
          newEmailNormalized: found.newEmailNormalized,
        },
      }),
      recordAuthEvent({
        type: "session_revoked",
        userId: found.userId,
        ipAddress: ip,
        userAgent: ua,
        metadata: { reason: "email_change" },
      }),
    ]);

    // Issue a fresh session on the confirming device so the user lands signed
    // in rather than bounced to /login — matching password-reset/confirm.
    const fresh = await createSession(found.userId, ua, ip);
    const res = NextResponse.json({
      ok: true,
      data: { email: found.newEmail },
    });
    setSessionCookie(res, fresh.rawToken, fresh.expiresAt);
    return res;
  } catch (e) {
    console.error("[api/auth/email-change/confirm] unhandled error", e);
    return NextResponse.json(
      { ok: false, error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } },
      { status: 500 },
    );
  }
}
