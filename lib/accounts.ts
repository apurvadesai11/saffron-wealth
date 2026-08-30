// Server-only query layer for accounts. Every function is scoped to a userId
// and treats {id, userId} as the ownership check — a mismatched id resolves to
// null/false rather than throwing, so callers can map that straight to 404.
import { Prisma, type PrismaClient, type Account as PrismaAccount } from "@prisma/client";
import { prisma } from "./prisma";
import { guessAccountType } from "./monarch-transform";
import type { Account, AccountInput, AccountPatch } from "./types";

function mapAccount(row: PrismaAccount): Account {
  return {
    id: row.id,
    name: row.name,
    type: row.type as Account["type"],
    institution: row.institution,
    balance: row.balance.toNumber(),
    balanceAsOf: row.balanceAsOf.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listAccounts(userId: string): Promise<Account[]> {
  const rows = await prisma.account.findMany({
    where: { userId, archivedAt: null },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(mapAccount);
}

export async function createAccount(userId: string, input: AccountInput): Promise<Account> {
  const balance = new Prisma.Decimal(input.balance);
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.account.create({
      data: {
        userId,
        name: input.name,
        type: input.type,
        institution: input.institution,
        balance,
      },
    });
    await tx.accountBalanceEvent.create({
      data: {
        userId,
        accountId: created.id,
        balance,
      },
    });
    return created;
  });
  return mapAccount(row);
}

export async function updateAccount(
  userId: string,
  id: string,
  patch: AccountPatch,
): Promise<Account | null> {
  const existing = await prisma.account.findFirst({
    where: { id, userId, archivedAt: null },
  });
  if (!existing) return null;

  const nextBalance =
    patch.balance !== undefined ? new Prisma.Decimal(patch.balance) : undefined;
  const balanceChanged = nextBalance !== undefined && !nextBalance.equals(existing.balance);

  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.account.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.institution !== undefined ? { institution: patch.institution } : {}),
        ...(balanceChanged
          ? { balance: nextBalance, balanceAsOf: new Date() }
          : {}),
      },
    });
    if (balanceChanged) {
      await tx.accountBalanceEvent.create({
        data: {
          userId,
          accountId: id,
          balance: nextBalance!,
        },
      });
    }
    return updated;
  });

  return mapAccount(row);
}

// Soft-delete: marks the account archived (hidden from listAccounts / net
// worth) but keeps its row and balance history for a future net-worth-over-time
// graph. Returns false if the account doesn't exist, isn't owned by userId, or
// is already archived — the route maps false to 404 either way.
export async function archiveAccount(userId: string, id: string): Promise<boolean> {
  const result = await prisma.account.updateMany({
    where: { id, userId, archivedAt: null },
    data: { archivedAt: new Date() },
  });
  return result.count === 1;
}

// Accepts either the singleton client or a $transaction callback's client —
// the Monarch import (Phase 2b) needs the latter so account creation shares
// one transaction with the category writes before it and the transaction
// writes after it.
export type AccountDbClient = PrismaClient | Prisma.TransactionClient;

// Resolves every name to an account id, matching by (userId, name) — Account
// has no DB-level unique constraint on that pair (unlike Category), so the
// match is enforced here in application code. Read-only unless `write` is
// true, mirroring lib/categories.ts's resolveCategoryIds so preview and
// commit share one code path and can never disagree about what's "new".
//
// A matched existing account is NEVER updated: the import has no balance to
// offer (a transaction export carries no balances), so overwriting a type
// the user already corrected would be strictly worse than leaving it alone.
export async function resolveAccountIds(
  userId: string,
  names: string[],
  client: AccountDbClient = prisma,
  write: boolean = false,
): Promise<{ idByName: Map<string, string>; newNames: Set<string> }> {
  const existing = names.length
    ? await client.account.findMany({
        where: { userId, name: { in: names } },
        select: { id: true, name: true },
      })
    : [];
  const idByName = new Map(existing.map((a) => [a.name, a.id]));
  const newNames = new Set(names.filter((n) => !idByName.has(n)));

  if (write) {
    for (const name of names) {
      if (!newNames.has(name)) continue;
      const zero = new Prisma.Decimal(0);
      const created = await client.account.create({
        data: { userId, name, type: guessAccountType(name), balance: zero },
      });
      // Mirrors createAccount's opening-balance event above, so an account
      // that only ever appears in a transaction import still has a starting
      // point for a future net-worth-over-time graph.
      await client.accountBalanceEvent.create({
        data: { userId, accountId: created.id, balance: zero },
      });
      idByName.set(name, created.id);
    }
  }

  return { idByName, newNames };
}
