import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/auth/rate-limit";
import { validateCsrfFromRequest } from "@/lib/auth/csrf";
import { recordAuthEvent } from "@/lib/auth/audit-log";
import { clientIp, userAgent } from "@/lib/auth/request-info";
import { normalizeEmail, validateEmail } from "@/lib/auth/validation";
import { createPasswordResetToken } from "@/lib/auth/reset-tokens";
import { sendPasswordResetEmail } from "@/lib/auth/email";

// Uniform success response used regardless of whether the email exists.
// Prevents enumeration via this endpoint.
function uniformSuccess() {
  return NextResponse.json({
    ok: true,
    data: {
      message:
        "If an account exists for that email, we've sent password reset instructions.",
    },
  });
}

// Floor the response time at this many ms so an attacker can't time the
// difference between user-found and user-not-found.
const RESPONSE_TIME_FLOOR_MS = 300;

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = clientIp(req);
  const ua = userAgent(req);

  const rl = await rateLimit("password-reset", ip ?? "unknown");
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: { code: "RATE_LIMITED", message: "Too many requests." } },
      { status: 429 },
    );
  }
  if (!validateCsrfFromRequest(req)) {
    return NextResponse.json(
      { ok: false, error: { code: "CSRF_FAILED", message: "Invalid request." } },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "BAD_REQUEST", message: "Invalid JSON body." } },
      { status: 400 },
    );
  }
  const rawEmail =
    typeof (body as { email?: unknown })?.email === "string"
      ? ((body as { email: string }).email)
      : "";
  if (validateEmail(rawEmail)) {
    // Even on shape-invalid email, return the uniform success shape.
    await sleepUntil(start + RESPONSE_TIME_FLOOR_MS);
    return uniformSuccess();
  }

  const emailNormalized = normalizeEmail(rawEmail);
  const user = await prisma.user.findUnique({
    where: { emailNormalized },
    select: { id: true, email: true, firstName: true, passwordHash: true },
  });

  // Only send if the user exists AND has a password (Google-only users have
  // no passwordHash — telling them to use Google is deferred to Phase E).
  if (user && user.passwordHash) {
    const { rawToken } = await createPasswordResetToken(user.id);
    const baseUrl =
      process.env.NEXTAUTH_URL ?? new URL(req.url).origin;
    const resetUrl = `${baseUrl}/password-reset/${encodeURIComponent(rawToken)}`;
    await sendPasswordResetEmail({
      to: user.email,
      firstName: user.firstName,
      resetUrl,
    }).catch(() => {
      // Email failure is logged inside email.ts; we don't surface it.
    });
    await recordAuthEvent({
      type: "password_reset_requested",
      userId: user.id,
      ipAddress: ip,
      userAgent: ua,
      metadata: { emailNormalized },
    });
  }

  await sleepUntil(start + RESPONSE_TIME_FLOOR_MS);
  return uniformSuccess();
}

function sleepUntil(targetMs: number): Promise<void> {
  const remaining = targetMs - Date.now();
  if (remaining <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, remaining));
}
