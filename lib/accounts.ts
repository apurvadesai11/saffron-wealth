// Server-only query layer for accounts. Every function is scoped to a userId
// and treats {id, userId} as the ownership check — a mismatched id resolves to
// null/false rather than throwing, so callers can map that straight to 404.
import { Prisma, type Account as PrismaAccount } from "@prisma/client";
import { prisma } from "./prisma";
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
