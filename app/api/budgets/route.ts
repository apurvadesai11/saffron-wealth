import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/server";
import { validateCsrfFromRequest } from "@/lib/auth/csrf";
import { saveBudgets } from "@/lib/budgets";
import { parseSaveBudgetsBody } from "@/lib/budget-validation";
import { InvalidReferenceError } from "@/lib/db-errors";

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

// Single endpoint for both a one-category manual budget save and "Auto-Set
// All" (many categories at once) — the client always sends a batch.
export async function PUT(req: NextRequest) {
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

    const parsed = parseSaveBudgetsBody(body);
    if (!parsed.ok) {
      return err("VALIDATION_FAILED", "Please correct the errors and try again.", 400, parsed.fieldErrors);
    }

    try {
      const budgets = await saveBudgets(session.user.id, parsed.value);
      return NextResponse.json({ ok: true, data: { budgets } });
    } catch (e) {
      if (e instanceof InvalidReferenceError) {
        return err("VALIDATION_FAILED", e.message, 400, { [e.field]: e.message });
      }
      throw e;
    }
  } catch (e) {
    console.error("[api/budgets] PUT unhandled error", e);
    return NextResponse.json(
      { ok: false, error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } },
      { status: 500 },
    );
  }
}
