import { NextResponse } from "next/server";
import { createTransaction, queryTransactions } from "@/lib/transactions";
import {
  parseCreateTransactionBody,
  parseTransactionQueryParams,
} from "@/lib/transaction-validation";
import { InvalidReferenceError, InvalidCursorError } from "@/lib/db-errors";
import { withApiHandler } from "@/lib/api/handler";
import { err } from "@/lib/api/errors";

// Filtered, paged read for the Transactions page. Deliberately no CSRF check:
// this is a safe read and every ordinary page load reaches it without the
// header, unlike the mutating handler below.
export const GET = withApiHandler(
  { logLabel: "api/transactions GET" },
  async ({ req, session }) => {
    const parsed = parseTransactionQueryParams(req.nextUrl.searchParams);
    if (!parsed.ok) {
      return err("VALIDATION_FAILED", "Invalid filter.", 400, { fieldErrors: parsed.fieldErrors });
    }

    try {
      const page = await queryTransactions(session.user.id, parsed.value);
      return NextResponse.json({ ok: true, data: page });
    } catch (e) {
      // A cursor the caller no longer owns (or never did) is a bad request,
      // not a server fault — it used to surface as a 500 from Prisma.
      if (e instanceof InvalidCursorError) {
        return err("INVALID_CURSOR", e.message, 400, { fieldErrors: { cursor: e.message } });
      }
      throw e;
    }
  },
);

export const POST = withApiHandler(
  { logLabel: "api/transactions POST", csrf: true },
  async ({ req, session }) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return err("BAD_REQUEST", "Invalid JSON body.", 400);
    }

    const parsed = parseCreateTransactionBody(body);
    if (!parsed.ok) {
      return err("VALIDATION_FAILED", "Please correct the errors and try again.", 400, { fieldErrors: parsed.fieldErrors });
    }

    try {
      const transaction = await createTransaction(session.user.id, parsed.value);
      return NextResponse.json({ ok: true, data: { transaction } }, { status: 201 });
    } catch (e) {
      if (e instanceof InvalidReferenceError) {
        return err("VALIDATION_FAILED", e.message, 400, { fieldErrors: { [e.field]: e.message } });
      }
      throw e;
    }
  },
);
