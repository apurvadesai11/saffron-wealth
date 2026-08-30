import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/server";
import { validateCsrfFromRequest } from "@/lib/auth/csrf";
import { parseCsv, validateHeader, CsvHeaderError } from "@/lib/csv";
import {
  runBalanceHistoryImportPipeline,
  REQUIRED_BALANCE_HISTORY_COLUMNS,
} from "@/lib/balance-history-import";

export const runtime = "nodejs";

// This is a global import (every account in one file), not [id]-scoped — see
// the Task 5 brief. The real Monarch balance-history export is 1.7 MB across
// ~34,000 rows; 20 MB is a guard against a mistaken upload, not a target.
const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

// A full import chunks ~34,248 events into ~7 createMany calls plus upserts
// for ~35 accounts, all inside one interactive transaction — comfortably
// past the transaction import's 20s budget for its much smaller (~7,600-row)
// file (app/api/transactions/import/route.ts), so raised here.
const IMPORT_TRANSACTION_TIMEOUT_MS = 30_000;

function err(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return err("UNAUTHENTICATED", "Not signed in.", 401);
    if (!validateCsrfFromRequest(req)) return err("CSRF_FAILED", "Invalid request.", 403);

    // Hard-stop an honestly-reported oversized request before reading the
    // body. This alone isn't the real guard (content-length is client-
    // supplied) — the file.size check below, once formData has actually
    // parsed the upload, is what a spoofed header can't get past.
    const contentLength = Number(req.headers.get("content-length") ?? "0");
    if (contentLength > MAX_IMPORT_BYTES + 8 * 1024) {
      return err("FILE_TOO_LARGE", "Maximum file size is 20MB.", 413);
    }

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return err("BAD_REQUEST", "Expected multipart/form-data with 'mode' and 'file' fields.", 400);
    }

    const modeValue = formData.get("mode");
    const mode = typeof modeValue === "string" ? modeValue : "";
    if (mode !== "preview" && mode !== "commit") {
      return err("BAD_REQUEST", "mode must be 'preview' or 'commit'.", 400);
    }

    const file = formData.get("file");
    if (!(file instanceof File)) {
      return err("BAD_REQUEST", "Missing 'file' field.", 400);
    }
    if (file.size > MAX_IMPORT_BYTES) {
      return err("FILE_TOO_LARGE", "Maximum file size is 20MB.", 413);
    }

    const text = await file.text();
    const { rows, header } = parseCsv(text);

    try {
      validateHeader(header, REQUIRED_BALANCE_HISTORY_COLUMNS);
    } catch (e) {
      if (e instanceof CsvHeaderError) return err("BAD_REQUEST", e.message, 400);
      throw e;
    }

    if (mode === "preview") {
      // Read-only: runBalanceHistoryImportPipeline never writes when commit
      // is false, so handing it the plain client (no transaction) is safe.
      const { summary } = await runBalanceHistoryImportPipeline(prisma, session.user.id, rows, header, {
        commit: false,
      });
      return NextResponse.json({ ok: true, summary });
    }

    // Accounts, then balance events — all inside one transaction so a
    // mid-import failure can't leave orphaned/half-updated accounts with no
    // matching history, or vice versa.
    const result = await prisma.$transaction(
      (tx) => runBalanceHistoryImportPipeline(tx, session.user.id, rows, header, { commit: true }),
      { timeout: IMPORT_TRANSACTION_TIMEOUT_MS },
    );
    return NextResponse.json({
      ok: true,
      summary: result.summary,
      eventsInserted: result.eventsInserted,
    });
  } catch (e) {
    console.error("[api/accounts/balance-history] unhandled error", e);
    return NextResponse.json(
      { ok: false, error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } },
      { status: 500 },
    );
  }
}
