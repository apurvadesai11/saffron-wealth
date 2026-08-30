// Server-only query layer for transactions.
import { prisma } from "./prisma";
import { InvalidReferenceError } from "./db-errors";
import type { Transaction, CategoryType } from "./types";

// The Transaction.date column is `@db.Date` (no time component). Reading and
// writing it in UTC-only arithmetic sidesteps the local-timezone shift that
// `new Date(y, m, d)` (local midnight) would risk on the write path.
function dateStringToUtcDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function utcDateToDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

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

export async function listTransactions(userId: string): Promise<Transaction[]> {
  const rows = await prisma.transaction.findMany({
    where: { userId },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  return rows.map(mapTransaction);
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
