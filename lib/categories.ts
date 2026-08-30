// Server-only query layer for categories. There is no create/edit/delete UI
// for categories yet (Phase 2a) — categories are only ever populated by
// seedDefaultCategories (new-user registration) or, later, the Monarch
// import's upsert-by-name (Phase 2b). listCategories is the only read path.
import { prisma } from "./prisma";
import type { Category } from "./types";

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
