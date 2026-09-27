import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TransactionList from "./TransactionList";
import { useApp } from "@/lib/app-context";
import {
  renderWithApp,
  CAT_GROCERIES,
  CAT_SALARY,
} from "./__tests__/test-utils";
import type { Transaction } from "@/lib/types";

// In production, `TransactionsPage` reads the transactions slice from context
// and passes a filtered list to `TransactionList`. For delete to be visible,
// the test parent has to follow the same pattern — otherwise the prop list
// is stale relative to the context the delete handler mutates.
function ConnectedList() {
  const { transactions } = useApp();
  return <TransactionList transactions={transactions} />;
}

const CATS = [CAT_GROCERIES, CAT_SALARY];

const EXPENSE_TX: Transaction = {
  id: "1",
  description: "Coffee",
  amount: 4.5,
  categoryId: CAT_GROCERIES.id,
  type: "expense",
  date: "2026-05-01",
};

const INCOME_TX: Transaction = {
  id: "2",
  description: "Paycheck",
  amount: 3000,
  categoryId: CAT_SALARY.id,
  type: "income",
  date: "2026-05-01",
};

describe("TransactionList", () => {
  it("shows an empty-state message when transactions is empty", () => {
    renderWithApp(<TransactionList transactions={[]} />, {
      categories: CATS,
      transactions: [],
    });
    expect(
      screen.getByText("No transactions match these filters."),
    ).toBeInTheDocument();
  });

  it("renders an income transaction with a leading '+' and the category name", () => {
    renderWithApp(<TransactionList transactions={[INCOME_TX]} />, {
      categories: CATS,
      transactions: [INCOME_TX],
    });
    expect(screen.getByText("Paycheck")).toBeInTheDocument();
    expect(screen.getByText(/\+\$3000\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Salary/)).toBeInTheDocument();
  });

  it("renders an expense transaction with a leading '-' sign", () => {
    renderWithApp(<TransactionList transactions={[EXPENSE_TX]} />, {
      categories: CATS,
      transactions: [EXPENSE_TX],
    });
    expect(screen.getByText(/-\$4\.50/)).toBeInTheDocument();
  });

  it("falls back to the raw categoryId when category lookup misses", () => {
    const orphaned: Transaction = { ...EXPENSE_TX, categoryId: "unknown-cat" };
    renderWithApp(<TransactionList transactions={[orphaned]} />, {
      categories: CATS,
      transactions: [orphaned],
    });
    expect(screen.getByText(/unknown-cat/)).toBeInTheDocument();
  });

  it("clicking the delete button removes the row via context", async () => {
    renderWithApp(<ConnectedList />, {
      categories: CATS,
      transactions: [EXPENSE_TX],
    });
    expect(screen.getByText("Coffee")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: /Delete Coffee/i }),
    );
    expect(screen.queryByText("Coffee")).not.toBeInTheDocument();
  });
});
