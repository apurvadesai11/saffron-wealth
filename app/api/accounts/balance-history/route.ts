import type { NextRequest } from "next/server";
import { handleCsvImport } from "@/lib/api/csv-import";
import {
  runBalanceHistoryImportPipeline,
  REQUIRED_BALANCE_HISTORY_COLUMNS,
} from "@/lib/balance-history-import";

export const runtime = "nodejs";

// A global import — every account in one file — rather than [id]-scoped,
// because that is the shape Monarch exports. The real export is 1.7 MB across
// ~34,000 rows; 20 MB is a guard against a mistaken upload, not a target.
const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

// A full import chunks ~34,248 events into ~7 createMany calls plus upserts
// for ~35 accounts, all inside one interactive transaction — comfortably
// past the transaction import's 20s budget for its much smaller (~7,600-row)
// file (app/api/transactions/import/route.ts), so raised here.
const IMPORT_TRANSACTION_TIMEOUT_MS = 30_000;

export async function POST(req: NextRequest) {
  return handleCsvImport(req, {
    maxBytes: MAX_IMPORT_BYTES,
    maxBytesLabel: "20MB",
    requiredColumns: REQUIRED_BALANCE_HISTORY_COLUMNS,
    timeoutMs: IMPORT_TRANSACTION_TIMEOUT_MS,
    rateLimitScope: "import",
    logLabel: "api/accounts/balance-history",
    // Accounts, then balance events — inside one transaction so a mid-import
    // failure can't leave orphaned/half-updated accounts with no matching
    // history, or vice versa.
    pipeline: runBalanceHistoryImportPipeline,
    commitBody: (result) => ({
      summary: result.summary,
      eventsInserted: result.eventsInserted,
    }),
  });
}
