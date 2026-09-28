import { NextResponse, type NextRequest } from "next/server";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/server";
import { validateCsrfFromRequest } from "@/lib/auth/csrf";
import { rateLimit } from "@/lib/auth/rate-limit";
import { parseCsv, validateHeader, CsvHeaderError } from "@/lib/csv";
import { err, internalError } from "./errors";

type ImportDbClient = PrismaClient | Prisma.TransactionClient;

/**
 * The CSV upload flow both import routes ran verbatim.
 *
 * POST /api/transactions/import and POST /api/accounts/balance-history were
 * ~95% identical: content-length guard, formData(), mode check, file check,
 * size check, parseCsv, validateHeader, then the preview-or-commit branch.
 * They differed in two constants, which pipeline they called, and the shape of
 * the commit response.
 *
 * Preview runs against the plain client, outside a transaction — both
 * pipelines are read-only when `commit` is false. Commit runs inside one
 * interactive transaction so a mid-import failure cannot leave half the rows
 * written, with an explicit timeout rather than Prisma's silent 5s default.
 */
export interface CsvImportConfig<R extends { summary: unknown }> {
  // The file-size cap, and the exact figure to name in the 413 message. The
  // label is passed rather than derived so the message stays byte-identical to
  // what each route sent before ("10MB", not "10.0 MB").
  maxBytes: number;
  maxBytesLabel: string;
  requiredColumns: string[];
  // Commit-transaction budget. Both routes measured their own: the ~7,600-row
  // transaction file needs 20s, the ~34,000-row balance history needs 30s.
  timeoutMs: number;
  // Rate-limit bucket, keyed by user id — these routes are authenticated, the
  // user id is whose resources are being spent, and IP is client-supplied.
  rateLimitScope: string;
  // Prefix for the unhandled-error log line, e.g. "api/transactions/import".
  logLabel: string;
  pipeline: (
    client: ImportDbClient,
    userId: string,
    rows: Record<string, string>[],
    header: string[],
    opts: { commit: boolean },
  ) => Promise<R>;
  // The commit response's payload, minus `ok`. The two routes report different
  // counts (imported/skipped vs eventsInserted), and the client reads them.
  commitBody: (result: R) => Record<string, unknown>;
}

export async function handleCsvImport<R extends { summary: unknown }>(
  req: NextRequest,
  config: CsvImportConfig<R>,
): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return err("UNAUTHENTICATED", "Not signed in.", 401);
    if (!validateCsrfFromRequest(req)) return err("CSRF_FAILED", "Invalid request.", 403);

    const rl = await rateLimit(config.rateLimitScope, session.user.id);
    if (!rl.ok) {
      return err("RATE_LIMITED", "Too many requests. Try again shortly.", 429);
    }

    // Hard-stop an honestly-reported oversized request before reading the
    // body. This alone isn't the real guard (content-length is client-
    // supplied) — the file.size check below, once formData has actually
    // parsed the upload, is what a spoofed header can't get past.
    const contentLength = Number(req.headers.get("content-length") ?? "0");
    if (contentLength > config.maxBytes + 8 * 1024) {
      return err("FILE_TOO_LARGE", `Maximum file size is ${config.maxBytesLabel}.`, 413);
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
    if (file.size > config.maxBytes) {
      return err("FILE_TOO_LARGE", `Maximum file size is ${config.maxBytesLabel}.`, 413);
    }

    const text = await file.text();
    const { rows, header } = parseCsv(text);

    try {
      validateHeader(header, config.requiredColumns);
    } catch (e) {
      if (e instanceof CsvHeaderError) return err("BAD_REQUEST", e.message, 400);
      throw e;
    }

    if (mode === "preview") {
      const { summary } = await config.pipeline(prisma, session.user.id, rows, header, {
        commit: false,
      });
      return NextResponse.json({ ok: true, summary });
    }

    const result = await prisma.$transaction(
      (tx) => config.pipeline(tx, session.user.id, rows, header, { commit: true }),
      { timeout: config.timeoutMs },
    );
    return NextResponse.json({ ok: true, ...config.commitBody(result) });
  } catch (e) {
    console.error(`[${config.logLabel}] unhandled error`, e);
    return internalError();
  }
}
