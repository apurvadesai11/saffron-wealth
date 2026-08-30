import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/server";
import { validateCsrfFromRequest } from "@/lib/auth/csrf";
import { deleteTransaction } from "@/lib/transactions";

interface ErrorBody {
  ok: false;
  error: { code: string; message: string };
}

function err(code: string, message: string, status: number) {
  return NextResponse.json<ErrorBody>({ ok: false, error: { code, message } }, { status });
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session) return err("UNAUTHENTICATED", "Not signed in.", 401);
    if (!validateCsrfFromRequest(req)) return err("CSRF_FAILED", "Invalid request.", 403);

    const { id } = await params;
    const deleted = await deleteTransaction(session.user.id, id);
    if (!deleted) return err("NOT_FOUND", "Transaction not found.", 404);

    return NextResponse.json({ ok: true, data: { id } });
  } catch (e) {
    console.error("[api/transactions/[id]] DELETE unhandled error", e);
    return NextResponse.json(
      { ok: false, error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } },
      { status: 500 },
    );
  }
}
