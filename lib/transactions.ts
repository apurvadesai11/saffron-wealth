// Server-only query layer for transactions.
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./prisma";
import { InvalidReferenceError } from "./db-errors";
import type { Transaction, CategoryType } from "./types";
// Transaction.date is `@db.Date`; see lib/date-utils.ts for why the
// conversions are UTC-only on both the read and the write path.
import { dateStringToUtcDate, utcDateToDateString } from "./date-utils";

function mapTransaction(row: {
  id: string;
  description: string;
  amount: { toNumber(): number };
  categoryId: string;
  type: string;
  date: Date;
  accountId: string | null;
  merchant: string | null;
  notes: string | null;
}): Transaction {
  return {
    id: row.id,
    description: row.description,
    amount: row.amount.toNumber(),
    categoryId: row.categoryId,
    type: row.type as CategoryType,
    date: utcDateToDateString(row.date),
    accountId: row.accountId,
    merchant: row.merchant,
    notes: row.notes,
  };
}

// Hydration read for the (app) layout. `from` bounds how far back it reaches:
// AppProvider's consumers (budget progress, alerts, cashflow, the monthly
// review) only ever need the current period plus the 12 complete periods
// getHistoricalAverage looks back over, and pulling the whole table put a
// Monarch-sized history — thousands of rows, megabytes of RSC payload — on
// every authenticated page navigation. Omitting `from` still returns
// everything, which is what the API routes and the importers want.
export async function listTransactions(
  userId: string,
  opts: { from?: string } = {},
): Promise<Transaction[]> {
  const rows = await prisma.transaction.findMany({
    where: {
      userId,
      ...(opts.from ? { date: { gte: dateStringToUtcDate(opts.from) } } : {}),
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  return rows.map(mapTransaction);
}

export interface TransactionQuery {
  from?: string; // "YYYY-MM-DD", inclusive
  to?: string; // "YYYY-MM-DD", inclusive
  type?: CategoryType;
  categoryIds?: string[];
  amountMin?: number;
  amountMax?: number;
  search?: string;
  limit?: number;
  cursor?: string; // a transaction id from a previous page's nextCursor
}

export interface TransactionPage {
  transactions: Transaction[];
  // Null on the last page. Callers pass it back as `cursor` to continue.
  nextCursor: string | null;
  // Count of ALL rows matching the filters, not just this page — the
  // Transactions page renders "N of M", and M has to survive paging.
  total: number;
}

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;

function buildWhere(userId: string, q: TransactionQuery): Prisma.TransactionWhereInput {
  const where: Prisma.TransactionWhereInput = { userId };

  if (q.from || q.to) {
    where.date = {
      ...(q.from ? { gte: dateStringToUtcDate(q.from) } : {}),
      ...(q.to ? { lte: dateStringToUtcDate(q.to) } : {}),
    };
  }
  if (q.type) where.type = q.type;
  if (q.categoryIds && q.categoryIds.length > 0) where.categoryId = { in: q.categoryIds };
  if (q.amountMin !== undefined || q.amountMax !== undefined) {
    where.amount = {
      ...(q.amountMin !== undefined ? { gte: q.amountMin } : {}),
      ...(q.amountMax !== undefined ? { lte: q.amountMax } : {}),
    };
  }
  // Matches the three fields the client-side filter searched (description and
  // category name) plus merchant, which the Monarch import populates and which
  // is what a user actually remembers about an imported row.
  if (q.search) {
    where.OR = [
      { description: { contains: q.search, mode: "insensitive" } },
      { merchant: { contains: q.search, mode: "insensitive" } },
      { category: { name: { contains: q.search, mode: "insensitive" } } },
    ];
  }

  return where;
}

// Filtered, cursor-paged read for the Transactions page. Replaces filtering a
// fully-hydrated array in the browser, which stopped being viable at import
// scale. `id` is the final orderBy key so the sort is total: date and
// createdAt can both tie, and a cursor against a non-deterministic order
// silently skips or repeats rows across pages.
export async function queryTransactions(
  userId: string,
  q: TransactionQuery,
): Promise<TransactionPage> {
  const where = buildWhere(userId, q);
  const limit = Math.min(Math.max(q.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);

  const [rows, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      // One extra row is the "is there a next page" probe — cheaper and more
      // accurate than comparing an offset against `total`, which can shift
      // under a concurrent write.
      take: limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    }),
    prisma.transaction.count({ where }),
  ]);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return {
    transactions: page.map(mapTransaction),
    nextCursor: hasMore ? page[page.length - 1].id : null,
    total,
  };
}

export interface CreateTransactionInput {
  description: string;
  amount: number;
  categoryId: string;
  type: CategoryType;
  date: string;
  accountId: string | null;
}

// Throws InvalidReferenceError if categoryId/accountId don't exist or aren't
// owned by userId — a Prisma FK violation alone wouldn't catch a categoryId
// that belongs to a *different* user.
export async function createTransaction(
  userId: string,
  input: CreateTransactionInput,
): Promise<Transaction> {
  const category = await prisma.category.findFirst({
    where: { id: input.categoryId, userId, archivedAt: null },
    select: { id: true },
  });
  if (!category) throw new InvalidReferenceError("categoryId", "Category not found.");

  if (input.accountId) {
    const account = await prisma.account.findFirst({
      where: { id: input.accountId, userId, archivedAt: null },
      select: { id: true },
    });
    if (!account) throw new InvalidReferenceError("accountId", "Account not found.");
  }

  const row = await prisma.transaction.create({
    data: {
      userId,
      categoryId: input.categoryId,
      accountId: input.accountId,
      description: input.description,
      amount: input.amount,
      type: input.type,
      date: dateStringToUtcDate(input.date),
    },
  });
  return mapTransaction(row);
}

export async function deleteTransaction(userId: string, id: string): Promise<boolean> {
  const result = await prisma.transaction.deleteMany({ where: { id, userId } });
  return result.count === 1;
}

// Accepts either the singleton client or a $transaction callback's client —
// the Monarch import (Phase 2b) needs the latter so these reads/writes share
// one transaction with the category and account writes around them.
export type TransactionDbClient = PrismaClient | Prisma.TransactionClient;

// Read-only dedup lookup shared by the import's preview (to report
// duplicateRows without writing anything) and commit (to compute the same
// summary before writing) — see lib/transaction-import.ts.
export async function findExistingExternalHashes(
  userId: string,
  hashes: string[],
  client: TransactionDbClient = prisma,
): Promise<Set<string>> {
  if (hashes.length === 0) return new Set();
  const rows = await client.transaction.findMany({
    where: { userId, externalHash: { in: hashes } },
    select: { externalHash: true },
  });
  return new Set(rows.map((r) => r.externalHash).filter((h): h is string => h !== null));
}

export interface ImportedTransactionRow {
  categoryId: string;
  accountId: string | null;
  description: string;
  merchant: string | null;
  notes: string | null;
  amount: number;
  type: CategoryType;
  date: string;
  externalHash: string;
}

// createMany + skipDuplicates relies on @@unique([userId, externalHash]):
// Postgres's ON CONFLICT DO NOTHING skips both rows that already exist in
// the table and later rows in this same batch that collide with an earlier
// one, so re-importing the same file (or a file with a genuinely repeated
// row) is naturally idempotent with no extra bookkeeping needed here.
export async function createImportedTransactions(
  userId: string,
  rows: ImportedTransactionRow[],
  client: TransactionDbClient = prisma,
): Promise<number> {
  if (rows.length === 0) return 0;
  const result = await client.transaction.createMany({
    data: rows.map((r) => ({
      userId,
      categoryId: r.categoryId,
      accountId: r.accountId,
      description: r.description,
      merchant: r.merchant,
      notes: r.notes,
      amount: r.amount,
      type: r.type,
      date: dateStringToUtcDate(r.date),
      externalHash: r.externalHash,
    })),
    skipDuplicates: true,
  });
  return result.count;
}
