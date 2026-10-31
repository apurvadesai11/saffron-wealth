import { NextResponse } from "next/server";
import { deleteTransaction, updateTransaction } from "@/lib/transactions";
import { parseUpdateTransactionBody } from "@/lib/transaction-validation";
import { InvalidReferenceError } from "@/lib/db-errors";
import { withApiHandler } from "@/lib/api/handler";
import { err } from "@/lib/api/errors";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export const PATCH = withApiHandler<RouteParams>(
  { logLabel: "api/transactions/[id] PATCH", csrf: true },
  async ({ req, session, routeContext }) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return err("BAD_REQUEST", "Invalid JSON body.", 400);
    }

    const parsed = parseUpdateTransactionBody(body);
    if (!parsed.ok) {
      return err("VALIDATION_FAILED", "Please correct the errors and try again.", 400, { fieldErrors: parsed.fieldErrors });
    }

    const { id } = await routeContext.params;
    try {
      const transaction = await updateTransaction(session.user.id, id, parsed.value);
      if (!transaction) return err("NOT_FOUND", "Transaction not found.", 404);
      return NextResponse.json({ ok: true, data: { transaction } });
    } catch (e) {
      if (e instanceof InvalidReferenceError) {
        return err("VALIDATION_FAILED", e.message, 400, { fieldErrors: { [e.field]: e.message } });
      }
      throw e;
    }
  },
);

export const DELETE = withApiHandler<RouteParams>(
  { logLabel: "api/transactions/[id] DELETE", csrf: true },
  async ({ session, routeContext }) => {
    const { id } = await routeContext.params;
    const deleted = await deleteTransaction(session.user.id, id);
    if (!deleted) return err("NOT_FOUND", "Transaction not found.", 404);

    return NextResponse.json({ ok: true, data: { id } });
  },
);
