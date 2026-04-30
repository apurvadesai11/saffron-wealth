import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/server";
import { validateCsrfFromRequest } from "@/lib/auth/csrf";
import { recordAuthEvent } from "@/lib/auth/audit-log";
import { clientIp, userAgent } from "@/lib/auth/request-info";
import {
  validateName,
  validateEmail,
  normalizeEmail,
} from "@/lib/auth/validation";
import {
  createSession,
  revokeAllSessionsForUser,
} from "@/lib/auth/sessions";
import { setSessionCookie } from "@/lib/auth/session-cookie";

interface ErrorBody {
  ok: false;
  error: { code: string; message: string; fieldErrors?: Record<string, string> };
}

function err(
  code: string,
  message: string,
  status: number,
  fieldErrors?: Record<string, string>,
) {
  return NextResponse.json<ErrorBody>(
    { ok: false, error: { code, message, ...(fieldErrors ? { fieldErrors } : {}) } },
    { status },
  );
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return err("UNAUTHENTICATED", "Not signed in.", 401);
  }
  return NextResponse.json({ ok: true, data: { user: session.user } });
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return err("UNAUTHENTICATED", "Not signed in.", 401);
  if (!validateCsrfFromRequest(req)) return err("CSRF_FAILED", "Invalid request.", 403);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return err("BAD_REQUEST", "Invalid JSON body.", 400);
  }
  if (typeof body !== "object" || body === null) {
    return err("BAD_REQUEST", "Invalid body.", 400);
  }
  const b = body as Record<string, unknown>;

  const fieldErrors: Record<string, string> = {};
  let firstName: string | undefined;
  let lastName: string | undefined;
  let email: string | undefined;

  if (typeof b.firstName === "string") {
    const e = validateName(b.firstName, "firstName");
    if (e) fieldErrors.firstName = e.message;
    else firstName = b.firstName.trim();
  }
  if (typeof b.lastName === "string") {
    const e = validateName(b.lastName, "lastName");
    if (e) fieldErrors.lastName = e.message;
    else lastName = b.lastName.trim();
  }
  if (typeof b.email === "string") {
    const e = validateEmail(b.email);
    if (e) fieldErrors.email = e.message;
    else email = b.email.trim();
  }
  if (Object.keys(fieldErrors).length > 0) {
    return err("VALIDATION_FAILED", "Please correct the errors and try again.", 400, fieldErrors);
  }

  const ip = clientIp(req);
  const ua = userAgent(req);

  // Check if email is actually changing.
  const existing = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { emailNormalized: true },
  });
  const newNormalized = email ? normalizeEmail(email) : null;
  const emailChanging =
    newNormalized !== null && newNormalized !== existing?.emailNormalized;

  if (emailChanging) {
    // Reject if another user already owns this email.
    const taken = await prisma.user.findUnique({
      where: { emailNormalized: newNormalized! },
      select: { id: true },
    });
    if (taken && taken.id !== session.user.id) {
      return err("EMAIL_EXISTS", "An account with that email already exists.", 409, {
        email: "An account with that email already exists.",
      });
    }
  }

  // Apply updates atomically; on email change, revoke all sessions in the
  // same transaction.
  const updates = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: session.user.id },
      data: {
        ...(firstName !== undefined ? { firstName } : {}),
        ...(lastName !== undefined ? { lastName } : {}),
        ...(email !== undefined && emailChanging
          ? { email, emailNormalized: newNormalized! }
          : {}),
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        profilePicture: true,
      },
    });
    if (emailChanging) {
      await tx.session.deleteMany({ where: { userId: session.user.id } });
    }
    return updated;
  });

  if (emailChanging) {
    await recordAuthEvent({
      type: "email_change",
      userId: session.user.id,
      ipAddress: ip,
      userAgent: ua,
      metadata: { previousEmailNormalized: existing?.emailNormalized },
    });
    await recordAuthEvent({
      type: "session_revoked",
      userId: session.user.id,
      ipAddress: ip,
      userAgent: ua,
      metadata: { reason: "email_change" },
    });

    // Issue a fresh session for the current device so the user isn't
    // immediately bounced to /login.
    const fresh = await createSession(session.user.id, ua, ip);
    const res = NextResponse.json({ ok: true, data: { user: updates } });
    setSessionCookie(res, fresh.rawToken, fresh.expiresAt);
    return res;
  }

  return NextResponse.json({ ok: true, data: { user: updates } });
}
