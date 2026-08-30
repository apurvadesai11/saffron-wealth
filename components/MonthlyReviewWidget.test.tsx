import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MonthlyReviewWidget from "./MonthlyReviewWidget";
import {
  renderWithApp,
  CAT_GROCERIES,
  CAT_RENT,
  CAT_SALARY,
} from "./__tests__/test-utils";
import type { Transaction, Budget } from "@/lib/types";

const CATS = [CAT_GROCERIES, CAT_RENT, CAT_SALARY];

// Pin "now" so transactions with date prefix YYYY-MM line up with the
// widget's default selected month. May 2026 picked arbitrarily.
const FIXED_NOW = new Date("2026-05-15T12:00:00Z");
const MONTH_PREFIX = "2026-05";

beforeEach(() => {
  // Only fake Date — leave setTimeout/queueMicrotask real so user-event's
  // internal scheduling still resolves. Freezing those deadlocks click/type.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(FIXED_NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

const sampleTx = (overrides: Partial<Transaction>): Transaction => ({
  id: `tx-${Math.floor(Math.random() * 1e9)}`,
  description: "x",
  amount: 100,
  categoryId: CAT_GROCERIES.id,
  type: "expense",
  date: `${MONTH_PREFIX}-10`,
  ...overrides,
});

describe("MonthlyReviewWidget", () => {
  it("defaults to the Budget tab and switches to Cashflow on click", async () => {
    renderWithApp(<MonthlyReviewWidget />, { categories: CATS, transactions: [], budgets: [] });
    expect(screen.getByRole("button", { name: /^budget$/i })).toHaveClass(/bg-gray-100/);
    await userEvent.click(screen.getByRole("button", { name: /^cashflow$/i }));
    expect(screen.getByRole("button", { name: /^cashflow$/i })).toHaveClass(/bg-gray-100/);
  });

  it("Cashflow tab shows the no-data state when the selected month has no spend", async () => {
    renderWithApp(<MonthlyReviewWidget />, {
      categories: CATS,
      transactions: [], // empty month
      budgets: [],
    });
    await userEvent.click(screen.getByRole("button", { name: /^cashflow$/i }));
    // No-data branch never renders the ranked "Spending by Category" header.
    expect(screen.queryByText(/Spending by Category/i)).not.toBeInTheDocument();
  });

  it("Cashflow tab renders ranked 'Spending by Category' bars when transactions exist", async () => {
    const transactions: Transaction[] = [
      sampleTx({ amount: 600, categoryId: CAT_RENT.id, description: "Rent" }),
      sampleTx({ amount: 150, categoryId: CAT_GROCERIES.id, description: "Trader Joes" }),
    ];
    renderWithApp(<MonthlyReviewWidget />, { categories: CATS, transactions, budgets: [] });
    await userEvent.click(screen.getByRole("button", { name: /^cashflow$/i }));

    const list = screen.getByText(/Spending by Category/i).parentElement!;
    const items = within(list).getAllByRole("listitem");
    // Rent ($600) should rank above Groceries ($150).
    expect(items[0]).toHaveTextContent(/Rent/);
    expect(items[0]).toHaveTextContent(/\$600\.00/);
    expect(items[1]).toHaveTextContent(/Groceries/);
  });

  it("'Auto-Set All' is shown only when categories are missing budgets, and clicking it auto-sets categories with history", async () => {
    const transactions: Transaction[] = [
      // 3 months of grocery history → Auto-Set has something to pull from.
      sampleTx({ amount: 300, categoryId: CAT_GROCERIES.id, date: "2026-02-10" }),
      sampleTx({ amount: 300, categoryId: CAT_GROCERIES.id, date: "2026-03-10" }),
      sampleTx({ amount: 300, categoryId: CAT_GROCERIES.id, date: "2026-04-10" }),
    ];
    // CAT_RENT has a budget; CAT_GROCERIES doesn't. Only use these two so
    // every unbudgeted category has history to auto-set from.
    const budgets: Budget[] = [{ categoryId: CAT_RENT.id, amount: 2000, period: "monthly" }];
    renderWithApp(<MonthlyReviewWidget />, {
      categories: [CAT_GROCERIES, CAT_RENT],
      transactions,
      budgets,
    });

    const autoSet = screen.getByRole("button", { name: /Auto-Set All/i });
    expect(autoSet).toBeInTheDocument();

    // Groceries currently appears under "No Budget Set".
    const noBudgetHeader = screen.getByText(/No Budget Set/i);
    expect(within(noBudgetHeader.parentElement!).getByText("Groceries")).toBeInTheDocument();

    await userEvent.click(autoSet);
    // After Auto-Set: every category has a budget, "No Budget Set" section is gone.
    expect(screen.queryByText(/No Budget Set/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Auto-Set All/i })).not.toBeInTheDocument();
  });

  it("clicking a budgeted row opens the BudgetEditModal", async () => {
    const budgets: Budget[] = [{ categoryId: CAT_GROCERIES.id, amount: 400, period: "monthly" }];
    renderWithApp(<MonthlyReviewWidget />, {
      categories: [CAT_GROCERIES],
      transactions: [],
      budgets,
    });
    await userEvent.click(screen.getByRole("button", { name: /Groceries/ }));
    // BudgetEditModal renders with role="dialog".
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
