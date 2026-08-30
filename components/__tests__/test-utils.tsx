import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { AppProvider } from "@/lib/app-context";
import type { Category, Transaction, Budget } from "@/lib/types";

interface AppRenderOptions extends Omit<RenderOptions, "wrapper"> {
  categories?: Category[];
  transactions?: Transaction[];
  budgets?: Budget[];
}

/**
 * Render a component wrapped in the real AppProvider. Tests can seed
 * categories / transactions / budgets to set up deterministic scenarios.
 * Omitted seeds fall back to the production mock data.
 */
export function renderWithApp(ui: ReactElement, opts: AppRenderOptions = {}) {
  const { categories, transactions, budgets, ...rest } = opts;
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <AppProvider
      seedCategories={categories}
      seedTransactions={transactions}
      seedBudgets={budgets}
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
