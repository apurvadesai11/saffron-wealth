// Server-only query layer for categories. There is no create/edit/delete UI
// for categories yet (Phase 2a) — categories are only ever populated by
// seedDefaultCategories (new-user registration) or, later, the Monarch
// import's upsert-by-name (Phase 2b). listCategories is the only read path.
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./prisma";
import type { Category, CategoryType } from "./types";

function mapCategory(row: {
  id: string;
  name: string;
  type: string;
  color: string;
}): Category {
  return { id: row.id, name: row.name, type: row.type as Category["type"], color: row.color };
}

export async function listCategories(userId: string): Promise<Category[]> {
  const rows = await prisma.category.findMany({
    where: { userId, archivedAt: null },
    orderBy: { sortOrder: "asc" },
  });
  return rows.map(mapCategory);
}

// Mirrors today's MOCK_CATEGORIES so a new user's app isn't empty before
// their first Monarch import. Defined here (not imported from mock-data.ts)
// because mock-data.ts is a test-fixture module in the mock/in-memory system
// this replaces — production code shouldn't depend on it.
const DEFAULT_CATEGORY_SEED: Array<Pick<Category, "name" | "type" | "color">> = [
  { name: "Housing", type: "expense", color: "bg-violet-500" },
  { name: "Groceries", type: "expense", color: "bg-orange-400" },
  { name: "Dining Out", type: "expense", color: "bg-yellow-500" },
  { name: "Transport", type: "expense", color: "bg-blue-400" },
  { name: "Entertainment", type: "expense", color: "bg-pink-400" },
  { name: "Utilities", type: "expense", color: "bg-cyan-500" },
  { name: "Other", type: "expense", color: "bg-gray-400" },
  { name: "Salary", type: "income", color: "bg-green-500" },
  { name: "Freelance", type: "income", color: "bg-emerald-400" },
];

// Idempotent: no-ops if the user already has any categories (e.g. called
// again by mistake, or a re-run in dev). Called once at registration.
export async function seedDefaultCategories(userId: string): Promise<void> {
  const existing = await prisma.category.count({ where: { userId } });
  if (existing > 0) return;

  await prisma.category.createMany({
    data: DEFAULT_CATEGORY_SEED.map((c, i) => ({ ...c, userId, sortOrder: i })),
  });
}

// Accepts either the singleton client or a $transaction callback's client —
// the Monarch import (Phase 2b) needs the latter so category creation shares
// one transaction with the account and transaction writes that follow it.
export type CategoryDbClient = PrismaClient | Prisma.TransactionClient;

// Round-robin palette for categories the Monarch import creates. Monarch's
// export carries no color of its own, and any deterministic order is fine —
// unlike DEFAULT_CATEGORY_SEED above, there's no meaningful color-to-category
// mapping to preserve.
const IMPORT_COLOR_PALETTE = [
  "bg-violet-500",
  "bg-orange-400",
  "bg-yellow-500",
  "bg-blue-400",
  "bg-pink-400",
  "bg-cyan-500",
  "bg-emerald-400",
  "bg-red-400",
  "bg-indigo-400",
  "bg-teal-400",
  "bg-lime-500",
  "bg-fuchsia-400",
];

// Resolves every entry to a category id, matching by (userId, name) — the
// import's upsert key. Read-only unless `write` is true: the import's
// preview mode calls this to learn which categories *would* be created
// without creating any, so preview and commit share one code path and can
// never disagree about what's "new". An existing match is never updated —
// there's no case yet where a re-import should override a category's type.
export async function resolveCategoryIds(
  userId: string,
  entries: { name: string; type: CategoryType }[],
  client: CategoryDbClient = prisma,
  write: boolean = false,
): Promise<{ idByName: Map<string, string>; newNames: Set<string> }> {
  const names = entries.map((e) => e.name);
  const existing = names.length
    ? await client.category.findMany({
        where: { userId, name: { in: names } },
        select: { id: true, name: true },
      })
    : [];
  const idByName = new Map(existing.map((c) => [c.name, c.id]));
  const newNames = new Set(names.filter((n) => !idByName.has(n)));

  if (write) {
    let colorIndex = 0;
    for (const entry of entries) {
      if (!newNames.has(entry.name)) continue;
      const created = await client.category.create({
        data: {
          userId,
          name: entry.name,
          type: entry.type,
          color: IMPORT_COLOR_PALETTE[colorIndex % IMPORT_COLOR_PALETTE.length],
        },
      });
      colorIndex++;
      idByName.set(entry.name, created.id);
    }
  }

  return { idByName, newNames };
}
