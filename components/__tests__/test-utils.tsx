import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { AppProvider } from "@/lib/app-context";
import { MOCK_CATEGORIES, MOCK_TRANSACTIONS, MOCK_BUDGETS } from "@/lib/mock-data";
import type { Category, Transaction, Budget } from "@/lib/types";

interface AppRenderOptions extends Omit<RenderOptions, "wrapper"> {
  categories?: Category[];
  transactions?: Transaction[];
  budgets?: Budget[];
  // Sets AppProvider's hydration window lower bound. Omitted means the seed
  // is treated as complete history, which is what most component tests want.
  transactionsFrom?: string;
}

/**
 * Render a component wrapped in the real AppProvider. Tests can seed
 * categories / transactions / budgets to set up deterministic scenarios.
 *
 * An omitted seed falls back to lib/mock-data. That default lives here rather
 * than in AppProvider, whose seed props are required precisely so production
 * cannot reach the mock arrays — the fixtures are a testing convenience, and
 * this is the only place entitled to supply them. A test that wants a genuinely
 * empty provider passes `[]`, which is distinct from omitting the prop.
 */
export function renderWithApp(ui: ReactElement, opts: AppRenderOptions = {}) {
  const {
    categories = MOCK_CATEGORIES,
    transactions = MOCK_TRANSACTIONS,
    budgets = MOCK_BUDGETS,
    transactionsFrom,
    ...rest
  } = opts;
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <AppProvider
      seedCategories={categories}
      seedTransactions={transactions}
      seedBudgets={budgets}
      transactionsFrom={transactionsFrom}
      offline
    >
      {children}
    </AppProvider>
  );
  return render(ui, { wrapper: Wrapper, ...rest });
}

// Convenience fixtures used across multiple test files.
export const CAT_GROCERIES: Category = {
  id: "cat-groc",
  name: "Groceries",
  type: "expense",
  color: "bg-green-500",
};
export const CAT_RENT: Category = {
  id: "cat-rent",
  name: "Rent",
  type: "expense",
  color: "bg-blue-500",
};
export const CAT_SALARY: Category = {
  id: "cat-salary",
  name: "Salary",
  type: "income",
  color: "bg-emerald-500",
};
