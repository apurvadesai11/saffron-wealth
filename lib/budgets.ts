// Server-only query layer for budgets. Budgets are always saved as a batch
// (one entry for a manual edit, many for "Auto-Set All") and upserted by the
// natural (userId, categoryId, period) key — there's no separate budget id
// the client ever needs to know about.
import { prisma } from "./prisma";
import { InvalidReferenceError } from "./db-errors";
import type { Budget } from "./types";

function mapBudget(row: {
  categoryId: string;
  amount: { toNumber(): number };
  period: string;
}): Budget {
  return {
    categoryId: row.categoryId,
    amount: row.amount.toNumber(),
    period: row.period as Budget["period"],
  };
}

export async function listBudgets(userId: string): Promise<Budget[]> {
  const rows = await prisma.budget.findMany({ where: { userId } });
  return rows.map(mapBudget);
}

// Upserts every entry inside one transaction (all-or-nothing), then returns
// the user's full, current budget list so the client can replace its local
// array wholesale — mirroring the array-replacement semantics the UI already
// used against the in-memory mock (`setBudgets(nextArray)`).
export async function saveBudgets(userId: string, entries: Budget[]): Promise<Budget[]> {
  const categoryIds = [...new Set(entries.map((e) => e.categoryId))];
  const owned = await prisma.category.findMany({
    where: { id: { in: categoryIds }, userId, archivedAt: null },
    select: { id: true },
  });
  const ownedIds = new Set(owned.map((c) => c.id));
  const missing = categoryIds.find((id) => !ownedIds.has(id));
  if (missing) throw new InvalidReferenceError("categoryId", "Category not found.");

  await prisma.$transaction(
    entries.map((e) =>
      prisma.budget.upsert({
        where: { userId_categoryId_period: { userId, categoryId: e.categoryId, period: e.period } },
        create: { userId, categoryId: e.categoryId, amount: e.amount, period: e.period },
        update: { amount: e.amount },
      }),
    ),
  );

  return listBudgets(userId);
}
