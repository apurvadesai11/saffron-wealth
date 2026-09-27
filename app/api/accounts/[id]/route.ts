import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/server";
import { validateCsrfFromRequest } from "@/lib/auth/csrf";
import { updateAccount, archiveAccount } from "@/lib/accounts";
import { parseUpdateAccountBody } from "@/lib/account-validation";

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

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
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

    const parsed = parseUpdateAccountBody(body);
    if (!parsed.ok) {
      return err("VALIDATION_FAILED", "Please correct the errors and try again.", 400, parsed.fieldErrors);
    }

    const { id } = await params;
    const account = await updateAccount(session.user.id, id, parsed.value);
    if (!account) return err("NOT_FOUND", "Account not found.", 404);

    return NextResponse.json({ ok: true, data: { account } });
  } catch (e) {
    console.error("[api/accounts/[id]] PATCH unhandled error", e);
    return NextResponse.json(
      { ok: false, error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session) return err("UNAUTHENTICATED", "Not signed in.", 401);
    if (!validateCsrfFromRequest(req)) return err("CSRF_FAILED", "Invalid request.", 403);

    const { id } = await params;
    const deleted = await archiveAccount(session.user.id, id);
    if (!deleted) return err("NOT_FOUND", "Account not found.", 404);

    return NextResponse.json({ ok: true, data: { id } });
  } catch (e) {
    console.error("[api/accounts/[id]] DELETE unhandled error", e);
    return NextResponse.json(
      { ok: false, error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } },
      { status: 500 },
    );
  }
}
