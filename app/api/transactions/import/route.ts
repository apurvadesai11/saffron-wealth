import type { NextRequest } from "next/server";
import { handleCsvImport } from "@/lib/api/csv-import";
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

export async function POST(req: NextRequest) {
  return handleCsvImport(req, {
    maxBytes: MAX_IMPORT_BYTES,
    maxBytesLabel: "10MB",
    requiredColumns: REQUIRED_IMPORT_COLUMNS,
    timeoutMs: IMPORT_TRANSACTION_TIMEOUT_MS,
    rateLimitScope: "import",
    logLabel: "api/transactions/import",
    // Categories, then accounts, then transactions — the pipeline's own order,
    // run inside one transaction so a mid-import failure can't leave orphaned
    // categories or accounts with no transactions pointing at them.
    pipeline: runImportPipeline,
    commitBody: (result) => ({
      summary: result.summary,
      imported: result.imported,
      skipped: result.skipped,
    }),
  });
}
