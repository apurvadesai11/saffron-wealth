// Two-pass transform + DB-aware planning for the Monarch transaction import
// (Task 3, Phase 2b). Pure CSV parsing lives in lib/csv.ts (Task 1); pure
// row transforms live in lib/monarch-transform.ts (Task 2); this module is
// the glue that needs the whole batch (inferCategoryType can't decide a
// category's type from one row) and the DB (dedup, existing accounts/
// categories) that neither of those pure modules can see.
//
// `runImportPipeline` is called identically by both API route modes so
// preview and commit can never compute a different-shaped summary for the
// same file: preview passes the plain `prisma` client with `commit: false`
// (read-only), commit passes a `$transaction` callback's client with
// `commit: true` (writes categories, then accounts, then transactions, in
// that order, inside the caller's single transaction).

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  classifyTransaction,
  inferCategoryType,
  buildExternalHash,
  guessAccountType,
  parseAmount,
} from "./monarch-transform";
import { resolveCategoryIds } from "./categories";
import { resolveAccountIds } from "./accounts";
import { findExistingExternalHashes, createImportedTransactions } from "./transactions";
import type { AccountType, CategoryType } from "./types";

export const REQUIRED_IMPORT_COLUMNS = ["Date", "Amount", "Account", "Category"];

type ImportDbClient = PrismaClient | Prisma.TransactionClient;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

interface ParsedRow {
  date: string;
  signedAmount: number;
  categoryName: string;
  accountName: string;
  merchant: string | null;
  notes: string | null;
  originalStatement: string | null;
  id: string | null;
}

// Case-insensitive + trimmed, mirroring lib/csv.ts's validateHeader
// normalization. A header that validated leniently (Ruling 2 — Monarch has
// added columns twice and will again) must also be READ leniently, or a
// column matched only by its normalized name would silently read as
// undefined here.
function buildColumnLookup(header: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const column of header) {
    map.set(column.trim().toLowerCase(), column);
  }
  return map;
}

function cell(row: Record<string, string>, lookup: Map<string, string>, name: string): string {
  const key = lookup.get(name.toLowerCase());
  if (!key) return "";
  return (row[key] ?? "").trim();
}

// Drops a row rather than throwing when a required cell is empty or Amount
// doesn't parse. lib/csv.ts already discards papaparse's own per-row parse
// errors (a Task 1 decision carried forward here rather than revisited —
// see the Task 3 report for why a dedicated `malformedRows` counter wasn't
// added instead): every row in the real export and this fixture has all
// four required cells populated, so a dropped row here means a genuinely
// unusable one, not a false negative.
function parseRow(raw: Record<string, string>, lookup: Map<string, string>): ParsedRow | null {
  const date = cell(raw, lookup, "date");
  const accountName = cell(raw, lookup, "account");
  const categoryName = cell(raw, lookup, "category");
  const amountRaw = cell(raw, lookup, "amount");
  if (!DATE_PATTERN.test(date) || accountName.length === 0 || categoryName.length === 0) {
    return null;
  }

  let signedAmount: number;
  try {
    signedAmount = parseAmount(amountRaw);
  } catch {
    return null;
  }

  return {
    date,
    signedAmount,
    categoryName,
    accountName,
    merchant: cell(raw, lookup, "merchant") || null,
    notes: cell(raw, lookup, "notes") || null,
    originalStatement: cell(raw, lookup, "original statement") || null,
    id: cell(raw, lookup, "id") || null,
  };
}

interface Candidate {
  date: string;
  amount: number; // positive; sign is carried by `type`
  type: CategoryType;
  categoryName: string;
  accountName: string;
  merchant: string | null;
  notes: string | null;
  originalStatement: string | null;
  externalHash: string;
  isFileDuplicate: boolean;
}

export interface ImportSummary {
  totalRows: number;
  newTransactions: number;
  duplicateRows: number;
  newAccounts: { name: string; guessedType: AccountType }[];
  newCategories: { name: string; inferredType: CategoryType }[];
  dateRange: { from: string; to: string };
}

export interface ImportPipelineResult {
  summary: ImportSummary;
  imported?: number;
  skipped?: number;
}

export async function runImportPipeline(
  client: ImportDbClient,
  userId: string,
  rawRows: Record<string, string>[],
  header: string[],
  opts: { commit: boolean },
): Promise<ImportPipelineResult> {
  const lookup = buildColumnLookup(header);
  const parsed = rawRows
    .map((r) => parseRow(r, lookup))
    .filter((r): r is ParsedRow => r !== null);

  // Pass 1: inferCategoryType needs every amount for a category before any
  // individual row belonging to that category can be typed.
  const amountsByCategory = new Map<string, number[]>();
  for (const row of parsed) {
    const list = amountsByCategory.get(row.categoryName);
    if (list) list.push(row.signedAmount);
    else amountsByCategory.set(row.categoryName, [row.signedAmount]);
  }
  const categoryTypeByName = new Map<string, CategoryType>();
  for (const [name, amounts] of amountsByCategory) {
    categoryTypeByName.set(name, inferCategoryType(name, amounts));
  }

  // Pass 2: build the final per-row shape, first-seen order for
  // categories/accounts (so summary lists and color/creation order are
  // stable), and the dedup key.
  const categoryEntries: { name: string; type: CategoryType }[] = [];
  const seenCategoryNames = new Set<string>();
  const accountNamesOrdered: string[] = [];
  const seenAccountNames = new Set<string>();
  const seenHashes = new Set<string>();
  const candidates: Candidate[] = [];
  let from = "";
  let to = "";

  for (const row of parsed) {
    if (!seenCategoryNames.has(row.categoryName)) {
      seenCategoryNames.add(row.categoryName);
      categoryEntries.push({ name: row.categoryName, type: categoryTypeByName.get(row.categoryName)! });
    }
    if (!seenAccountNames.has(row.accountName)) {
      seenAccountNames.add(row.accountName);
      accountNamesOrdered.push(row.accountName);
    }
    if (from === "" || row.date < from) from = row.date;
    if (to === "" || row.date > to) to = row.date;

    const { type, amount } = classifyTransaction(row.categoryName, row.signedAmount);
    const externalHash = buildExternalHash({
      id: row.id,
      date: row.date,
      amount: row.signedAmount,
      account: row.accountName,
      merchant: row.merchant,
      originalStatement: row.originalStatement,
    });
    const isFileDuplicate = seenHashes.has(externalHash);
    if (!isFileDuplicate) seenHashes.add(externalHash);

    candidates.push({
      date: row.date,
      amount,
      type,
      categoryName: row.categoryName,
      accountName: row.accountName,
      merchant: row.merchant,
      notes: row.notes,
      originalStatement: row.originalStatement,
      externalHash,
      isFileDuplicate,
    });
  }

  // Only the first-seen occurrence of each hash needs a DB round trip — a
  // within-file repeat is already known to be a duplicate without asking.
  const existingHashes = await findExistingExternalHashes(userId, [...seenHashes], client);
  let newTransactions = 0;
  let duplicateRows = 0;
  for (const c of candidates) {
    if (c.isFileDuplicate || existingHashes.has(c.externalHash)) duplicateRows++;
    else newTransactions++;
  }

  // Read-only when !opts.commit (the preview path) — resolveCategoryIds/
  // resolveAccountIds only create rows when told to write, so preview can
  // report "would create" without ever mutating anything.
  const { idByName: categoryIdByName, newNames: newCategoryNames } = await resolveCategoryIds(
    userId,
    categoryEntries,
    client,
    opts.commit,
  );
  const { idByName: accountIdByName, newNames: newAccountNames } = await resolveAccountIds(
    userId,
    accountNamesOrdered,
    client,
    opts.commit,
  );

  const summary: ImportSummary = {
    totalRows: rawRows.length,
    newTransactions,
    duplicateRows,
    newAccounts: accountNamesOrdered
      .filter((name) => newAccountNames.has(name))
      .map((name) => ({ name, guessedType: guessAccountType(name) })),
    newCategories: categoryEntries
      .filter((e) => newCategoryNames.has(e.name))
      .map((e) => ({ name: e.name, inferredType: e.type })),
    dateRange: { from, to },
  };

  if (!opts.commit) {
    return { summary };
  }

  // Fallback chain for the one field Monarch doesn't export directly:
  // merchant is the most human-readable, the original bank statement text
  // is the next best thing, and the category name is the last resort so
  // `description` (NOT NULL) is never empty.
  const imported = await createImportedTransactions(
    userId,
    candidates.map((c) => ({
      categoryId: categoryIdByName.get(c.categoryName)!,
      accountId: accountIdByName.get(c.accountName) ?? null,
      description: c.merchant || c.originalStatement || c.categoryName,
      merchant: c.merchant,
      notes: c.notes,
      amount: c.amount,
      type: c.type,
      date: c.date,
      externalHash: c.externalHash,
    })),
    client,
  );

  return { summary, imported, skipped: candidates.length - imported };
}
