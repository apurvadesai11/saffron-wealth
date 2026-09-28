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
import { createEmailChangeToken } from "@/lib/auth/email-change-tokens";
import {
  sendEmailChangeConfirmation,
  sendEmailChangeNotice,
} from "@/lib/auth/email";

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
  try {
    const session = await getSession();
    if (!session) {
      return err("UNAUTHENTICATED", "Not signed in.", 401);
    }
    return NextResponse.json({ ok: true, data: { user: session.user } });
  } catch (e) {
    console.error("[api/profile] GET unhandled error", e);
    return NextResponse.json(
      { ok: false, error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
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
      select: { email: true, emailNormalized: true, firstName: true },
    });
    const newNormalized = email ? normalizeEmail(email) : null;
    const emailChanging =
      newNormalized !== null && newNormalized !== existing?.emailNormalized;

    if (emailChanging) {
      // Reject if another user already owns this email. Re-checked again at
      // confirm time, since this answer can go stale while the link sits in an
      // inbox.
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

    // Names apply immediately; the email does NOT. Mutating User.email here
    // used to move an account onto an address nobody had proven they control,
    // which let an attacker park on a victim's address before the victim ever
    // signed up. The address now changes only at
    // POST /api/auth/email-change/confirm, reached via a link sent to it.
    const updated = await prisma.user.update({
      where: { id: session.user.id },
      data: {
        ...(firstName !== undefined ? { firstName } : {}),
        ...(lastName !== undefined ? { lastName } : {}),
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        profilePicture: true,
      },
    });

    if (!emailChanging) {
      return NextResponse.json({
        ok: true,
        data: { user: updated, emailChangePending: false },
      });
    }

    const { rawToken } = await createEmailChangeToken(
      session.user.id,
      email!,
      newNormalized!,
    );
    const baseUrl = process.env.APP_BASE_URL ?? new URL(req.url).origin;
    // /email-change, not /profile/..., because the link is opened from the new
    // inbox on a possibly signed-out device; /profile is session-gated.
    const confirmUrl = `${baseUrl}/email-change/${encodeURIComponent(rawToken)}`;

    // Both sends are best-effort: a mail failure must not roll back the name
    // changes that already applied, and must not leak whether delivery worked.
    // The notice to the OLD address is what surfaces a change the account
    // owner did not initiate.
    await Promise.allSettled([
      sendEmailChangeConfirmation({
        to: email!,
        firstName: updated.firstName,
        confirmUrl,
      }),
      existing?.email
        ? sendEmailChangeNotice({
            to: existing.email,
            firstName: existing.firstName ?? updated.firstName,
            newEmail: email!,
          })
        : Promise.resolve(),
    ]);

    await recordAuthEvent({
      type: "email_change_requested",
      userId: session.user.id,
      ipAddress: ip,
      userAgent: ua,
      metadata: {
        previousEmailNormalized: existing?.emailNormalized,
        requestedEmailNormalized: newNormalized,
      },
    });

    return NextResponse.json({
      ok: true,
      data: {
        // Still the OLD address — the caller must not render the new one as
        // though it had taken effect.
        user: updated,
        emailChangePending: true,
        pendingEmail: email,
        message: "Check your new inbox to confirm the address. It stays unchanged until you do.",
      },
    });
  } catch (e) {
    console.error("[api/profile] PATCH unhandled error", e);
    return NextResponse.json(
      { ok: false, error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } },
      { status: 500 },
    );
  }
}
