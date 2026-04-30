import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, validatePasswordRules } from "@/lib/auth/password";
import { isCommonPassword } from "@/lib/auth/blocklist";
import { checkPwnedPassword } from "@/lib/auth/hibp";
import {
  parseRegisterBody,
  validateEmail,
  validateName,
  normalizeEmail,
} from "@/lib/auth/validation";
import { createSession } from "@/lib/auth/sessions";
import { setSessionCookie } from "@/lib/auth/session-cookie";
import { rateLimit } from "@/lib/auth/rate-limit";
import { recordAuthEvent } from "@/lib/auth/audit-log";
import { validateCsrfFromRequest } from "@/lib/auth/csrf";
import { clientIp, userAgent } from "@/lib/auth/request-info";

interface ErrorBody {
  ok: false;
  error: { code: string; message: string; fieldErrors?: Record<string, string> };
}

function err(
  code: string,
  message: string,
  status: number,
  fieldErrors?: Record<string, string>,
): NextResponse<ErrorBody> {
  return NextResponse.json<ErrorBody>(
    { ok: false, error: { code, message, ...(fieldErrors ? { fieldErrors } : {}) } },
    { status },
  );
}

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req);
    const ua = userAgent(req);

    const rl = await rateLimit("register", ip ?? "unknown");
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

    const parsed = parseRegisterBody(body);
    if (!parsed) {
      return err("BAD_REQUEST", "Missing required fields.", 400);
    }

    const fieldErrors: Record<string, string> = {};
    const firstNameErr = validateName(parsed.firstName, "firstName");
    if (firstNameErr) fieldErrors.firstName = firstNameErr.message;
    const lastNameErr = validateName(parsed.lastName, "lastName");
    if (lastNameErr) fieldErrors.lastName = lastNameErr.message;
    const emailErr = validateEmail(parsed.email);
    if (emailErr) fieldErrors.email = emailErr.message;

    const ruleResult = validatePasswordRules(parsed.password);
    if (!ruleResult.ok) fieldErrors.password = ruleResult.errors[0];

    if (Object.keys(fieldErrors).length > 0) {
      return err("VALIDATION_FAILED", "Please correct the errors and try again.", 400, fieldErrors);
    }

    if (isCommonPassword(parsed.password)) {
      return err(
        "PASSWORD_TOO_COMMON",
        "That password is too common. Pick a more unique one.",
        400,
        { password: "Password is on the common-password blocklist." },
      );
    }

    const hibp = await checkPwnedPassword(parsed.password);
    if (hibp.unavailable) {
      await recordAuthEvent({ type: "hibp_unavailable", ipAddress: ip, userAgent: ua });
    } else if (hibp.pwned) {
      return err(
        "PASSWORD_PWNED",
        "This password has appeared in a known data breach. Choose a different one.",
        400,
        { password: "Password appeared in a public breach. Pick another." },
      );
    }

    const emailNormalized = normalizeEmail(parsed.email);

    const existing = await prisma.user.findUnique({
      where: { emailNormalized },
      select: { id: true },
    });
    if (existing) {
      return err(
        "EMAIL_EXISTS",
        "An account with this email already exists.",
        409,
        { email: "An account with this email already exists." },
      );
    }

    const passwordHash = await hashPassword(parsed.password);

    const user = await prisma.user.create({
      data: {
        email: parsed.email.trim(),
        emailNormalized,
        firstName: parsed.firstName.trim(),
        lastName: parsed.lastName.trim(),
        passwordHash,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        profilePicture: true,
      },
    });

    const session = await createSession(user.id, ua, ip);

    await Promise.all([
      recordAuthEvent({ type: "signup", userId: user.id, ipAddress: ip, userAgent: ua }),
      recordAuthEvent({ type: "login_success", userId: user.id, ipAddress: ip, userAgent: ua,
        metadata: { emailNormalized } }),
    ]);

    const res = NextResponse.json({ ok: true, data: { user } });
    setSessionCookie(res, session.rawToken, session.expiresAt);
    return res;
  } catch (e) {
    console.error("[api/auth/register] unhandled error", e);
    return NextResponse.json(
      { ok: false, error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } },
      { status: 500 },
    );
  }
}
