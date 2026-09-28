import { NextResponse } from "next/server";
import { saveBudgets } from "@/lib/budgets";
import { parseSaveBudgetsBody } from "@/lib/budget-validation";
import { InvalidReferenceError } from "@/lib/db-errors";
import { withApiHandler } from "@/lib/api/handler";
import { err } from "@/lib/api/errors";

// Single endpoint for both a one-category manual budget save and "Auto-Set
// All" (many categories at once) — the client always sends a batch.
export const PUT = withApiHandler(
  { logLabel: "api/budgets PUT", csrf: true },
  async ({ req, session }) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return err("BAD_REQUEST", "Invalid JSON body.", 400);
    }

    const parsed = parseSaveBudgetsBody(body);
    if (!parsed.ok) {
      return err("VALIDATION_FAILED", "Please correct the errors and try again.", 400, { fieldErrors: parsed.fieldErrors });
    }

    try {
      const budgets = await saveBudgets(session.user.id, parsed.value);
      return NextResponse.json({ ok: true, data: { budgets } });
    } catch (e) {
      if (e instanceof InvalidReferenceError) {
        return err("VALIDATION_FAILED", e.message, 400, { fieldErrors: { [e.field]: e.message } });
      }
      throw e;
    }
  },
);
