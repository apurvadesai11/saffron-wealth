import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/server";
import { validateCsrfFromRequest } from "@/lib/auth/csrf";
import { parseCsv, validateHeader, CsvHeaderError } from "@/lib/csv";
import { runImportPipeline, REQUIRED_IMPORT_COLUMNS } from "@/lib/transaction-import";

export const runtime = "nodejs";

// The real Monarch transaction export is 976 KB. 10 MB is a guard against a
// mistaken upload (e.g. the wrong file picked), not a target — mirrors the
// early-reject pattern in app/api/profile/picture/route.ts.
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

// Commit does 2 category upserts + N account/category creates + one
// createMany, all in one interactive transaction. Prisma's 5s default
// transaction timeout is comfortable for a test fixture but not for the
// real ~7,600-row file this route exists to import, so it's raised here
// rather than left implicit.
const IMPORT_TRANSACTION_TIMEOUT_MS = 20_000;

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
      return err("FILE_TOO_LARGE", "Maximum file size is 10MB.", 413);
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
      return err("FILE_TOO_LARGE", "Maximum file size is 10MB.", 413);
    }

    const text = await file.text();
    const { rows, header } = parseCsv(text);

    try {
      validateHeader(header, REQUIRED_IMPORT_COLUMNS);
    } catch (e) {
      if (e instanceof CsvHeaderError) return err("BAD_REQUEST", e.message, 400);
      throw e;
    }

    if (mode === "preview") {
      // Read-only: runImportPipeline never writes when commit is false, so
      // handing it the plain client (no transaction) is safe here.
      const { summary } = await runImportPipeline(prisma, session.user.id, rows, header, {
        commit: false,
      });
      return NextResponse.json({ ok: true, summary });
    }

    // Categories, then accounts, then transactions — all inside one
    // transaction so a mid-import failure can't leave orphaned categories
    // or accounts with no transactions pointing at them.
    const result = await prisma.$transaction(
      (tx) => runImportPipeline(tx, session.user.id, rows, header, { commit: true }),
      { timeout: IMPORT_TRANSACTION_TIMEOUT_MS },
    );
    return NextResponse.json({
      ok: true,
      summary: result.summary,
      imported: result.imported,
      skipped: result.skipped,
    });
  } catch (e) {
    console.error("[api/transactions/import] unhandled error", e);
    return NextResponse.json(
      { ok: false, error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } },
      { status: 500 },
    );
  }
}
