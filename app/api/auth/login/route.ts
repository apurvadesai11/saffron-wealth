import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  verifyPassword,
  getDummyHash,
} from "@/lib/auth/password";
import {
  parseLoginBody,
  normalizeEmail,
} from "@/lib/auth/validation";
import { createSession } from "@/lib/auth/sessions";
import { setSessionCookie } from "@/lib/auth/session-cookie";
import { rateLimit } from "@/lib/auth/rate-limit";
import { recordAuthEvent } from "@/lib/auth/audit-log";
import { validateCsrfFromRequest } from "@/lib/auth/csrf";
import { clientIp, userAgent } from "@/lib/auth/request-info";
import {
  getBackoffStatus,
  clearFailedLoginsForUser,
  acquireLoginLock,
} from "@/lib/auth/exponential-backoff";

interface ErrorBody {
  ok: false;
  error: { code: string; message: string; retryAfterSeconds?: number };
}

function err(code: string, message: string, status: number, retryAfterSeconds?: number) {
  return NextResponse.json<ErrorBody>(
    { ok: false, error: { code, message, ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}) } },
    { status },
  );
}

const UNIFORM_INVALID = () =>
  err("INVALID_CREDENTIALS", "Email or password is incorrect.", 401);

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req);
    const ua = userAgent(req);

    const rl = await rateLimit("login", ip ?? "unknown");
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
    const parsed = parseLoginBody(body);
    if (!parsed) return err("BAD_REQUEST", "Missing required fields.", 400);

    const emailNormalized = normalizeEmail(parsed.email);

    // Wrap the entire credential check in a single transaction holding a
    // Postgres advisory lock keyed on the email — closes the concurrent-bypass
    // race on the exponential-backoff window.
    const result = await prisma.$transaction(async (tx) => {
      await acquireLoginLock(tx, emailNormalized);

      const backoff = await getBackoffStatus(emailNormalized);
      if (!backoff.allowed) {
        const retrySec = Math.ceil(
          (backoff.retryAfter.getTime() - Date.now()) / 1000,
        );
        return { kind: "backoff" as const, retrySec };
      }

      const user = await tx.user.findUnique({
        where: { emailNormalized },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          profilePicture: true,
          passwordHash: true,
        },
      });

      // Always run an Argon2 verify (against a dummy hash if the email is
      // unknown or the user has no passwordHash) to keep response times uniform
      // and prevent timing-based account enumeration.
      const stored = user?.passwordHash ?? (await getDummyHash());
      const verified = await verifyPassword(parsed.password, stored);

      if (!verified || !user || !user.passwordHash) {
        await tx.failedLogin.create({
          data: {
            userId: user?.id ?? null,
            emailNormalized,
            ipAddress: ip,
          },
        });
        return { kind: "fail" as const };
      }

      await tx.failedLogin.deleteMany({ where: { userId: user.id } });

      return {
        kind: "ok" as const,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          profilePicture: user.profilePicture,
        },
      };
    });

    if (result.kind === "backoff") {
      await recordAuthEvent({
        type: "login_failure",
        ipAddress: ip,
        userAgent: ua,
        metadata: { emailNormalized, reason: "backoff" },
      });
      return err(
        "TOO_MANY_FAILED_ATTEMPTS",
        "Too many failed attempts. Please wait before retrying.",
        429,
        result.retrySec,
      );
    }

    if (result.kind === "fail") {
      await recordAuthEvent({
        type: "login_failure",
        ipAddress: ip,
        userAgent: ua,
        metadata: { emailNormalized },
      });
      return UNIFORM_INVALID();
    }

    // Outside the transaction: create session + cookie + success audit event.
    // We deliberately split this out to keep the locked transaction short.
    const session = await createSession(result.user.id, ua, ip);
    await recordAuthEvent({
      type: "login_success",
      userId: result.user.id,
      ipAddress: ip,
      userAgent: ua,
      metadata: { emailNormalized },
    });

    // Defensive: clearFailedLoginsForUser is also done inside the tx, but keep a
    // best-effort outside cleanup as well in case a stale row was created via a
    // separate code path.
    await clearFailedLoginsForUser(result.user.id).catch(() => {});

    const res = NextResponse.json({ ok: true, data: { user: result.user } });
    setSessionCookie(res, session.rawToken, session.expiresAt);
    return res;
  } catch (e) {
    console.error("[api/auth/login] unhandled error", e);
    return NextResponse.json(
      { ok: false, error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } },
      { status: 500 },
    );
  }
}
