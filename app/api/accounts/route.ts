import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/server";
import { validateCsrfFromRequest } from "@/lib/auth/csrf";
import { listAccounts, createAccount } from "@/lib/accounts";
import { parseCreateAccountBody } from "@/lib/account-validation";

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
    if (!session) return err("UNAUTHENTICATED", "Not signed in.", 401);

    const accounts = await listAccounts(session.user.id);
    return NextResponse.json({ ok: true, data: { accounts } });
  } catch (e) {
    console.error("[api/accounts] GET unhandled error", e);
    return NextResponse.json(
      { ok: false, error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
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

    const parsed = parseCreateAccountBody(body);
    if (!parsed.ok) {
      return err("VALIDATION_FAILED", "Please correct the errors and try again.", 400, parsed.fieldErrors);
    }

    const account = await createAccount(session.user.id, parsed.value);
    return NextResponse.json({ ok: true, data: { account } }, { status: 201 });
  } catch (e) {
    console.error("[api/accounts] POST unhandled error", e);
    return NextResponse.json(
      { ok: false, error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } },
      { status: 500 },
    );
  }
}
