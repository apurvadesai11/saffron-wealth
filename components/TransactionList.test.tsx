import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TransactionList from "./TransactionList";
import { useApp } from "@/lib/app-context";
import {
  renderWithApp,
  CAT_GROCERIES,
  CAT_SALARY,
} from "./__tests__/test-utils";
import { contrastRatio, textTokenClass, tokenHex } from "./__tests__/contrast";
import type { Transaction } from "@/lib/types";

// In production, `TransactionsPage` reads the transactions slice from context
// and passes a filtered list to `TransactionList`. For delete to be visible,
// the test parent has to follow the same pattern — otherwise the prop list
// is stale relative to the context the delete handler mutates.
function ConnectedList() {
  const { transactions } = useApp();
  return <TransactionList transactions={transactions} onEdit={() => {}} />;
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
    renderWithApp(<TransactionList transactions={[]} onEdit={vi.fn()} />, {
      categories: CATS,
      transactions: [],
    });
    expect(
      screen.getByText("No transactions match these filters."),
    ).toBeInTheDocument();
  });

  it("renders an income transaction with a leading '+' and the category name", () => {
    renderWithApp(<TransactionList transactions={[INCOME_TX]} onEdit={vi.fn()} />, {
      categories: CATS,
      transactions: [INCOME_TX],
    });
    expect(screen.getByText("Paycheck")).toBeInTheDocument();
    expect(screen.getByText(/\+\$3,000\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Salary/)).toBeInTheDocument();
  });

  it("renders an expense transaction with a leading '-' sign", () => {
    renderWithApp(<TransactionList transactions={[EXPENSE_TX]} onEdit={vi.fn()} />, {
      categories: CATS,
      transactions: [EXPENSE_TX],
    });
    expect(screen.getByText(/-\$4\.50/)).toBeInTheDocument();
  });

  it("falls back to the raw categoryId when category lookup misses", () => {
    const orphaned: Transaction = { ...EXPENSE_TX, categoryId: "unknown-cat" };
    renderWithApp(<TransactionList transactions={[orphaned]} onEdit={vi.fn()} />, {
      categories: CATS,
      transactions: [orphaned],
    });
    expect(screen.getByText(/unknown-cat/)).toBeInTheDocument();
  });

  it("opens a transaction for editing when its row is clicked", async () => {
    const onEdit = vi.fn();
    renderWithApp(<TransactionList transactions={[EXPENSE_TX]} onEdit={onEdit} />, {
      categories: CATS,
      transactions: [EXPENSE_TX],
    });

    await userEvent.click(screen.getByRole("button", { name: /Edit Coffee/ }));

    expect(onEdit).toHaveBeenCalledWith(EXPENSE_TX);
  });

  it("does not open the editor when the delete control is clicked", async () => {
    const onEdit = vi.fn();
    renderWithApp(<TransactionList transactions={[EXPENSE_TX]} onEdit={onEdit} />, {
      categories: CATS,
      transactions: [EXPENSE_TX],
    });

    await userEvent.click(screen.getByRole("button", { name: /Delete Coffee/ }));

    expect(onEdit).not.toHaveBeenCalled();
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

describe("TransactionList month dividers", () => {
  const rows: Transaction[] = [
    { ...EXPENSE_TX, id: "oct-2", description: "Oct later", date: "2026-10-05" },
    { ...EXPENSE_TX, id: "oct-1", description: "Oct earlier", date: "2026-10-01" },
    { ...EXPENSE_TX, id: "sep-1", description: "Sep last", date: "2026-09-30" },
    { ...EXPENSE_TX, id: "jan-1", description: "Jan", date: "2025-01-15" },
  ];

  it("labels the start of each month, once, above that month's rows", () => {
    renderWithApp(<TransactionList transactions={rows} onEdit={vi.fn()} />, {
      categories: CATS,
      transactions: rows,
    });

    const items = screen.getAllByRole("listitem").map((li) =>
      li.querySelector("h3")?.textContent ?? li.querySelector("p")?.textContent,
    );
    expect(items).toEqual([
      "October 2026", "Oct later", "Oct earlier",
      "September 2026", "Sep last",
      "January 2025", "Jan",
    ]);
  });

  it("names each divider as a heading", () => {
    renderWithApp(<TransactionList transactions={rows} onEdit={vi.fn()} />, {
      categories: CATS,
      transactions: rows,
    });

    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "October 2026", "September 2026", "January 2025",
    ]);
  });
});

// 14b — the plan asks for this control to be audited for the same contrast and
// hit-target problems AccountRow's had. The wording is not in scope here:
// deleteTransaction really does remove the row, so "Delete" is accurate.
describe("TransactionList delete control accessibility", () => {
  const MIN_UI_CONTRAST = 3;

  it("clears WCAG 1.4.11's 3:1 and reserves a 24x24 hit target", () => {
    renderWithApp(<TransactionList transactions={[EXPENSE_TX]} onEdit={vi.fn()} />, {
      categories: CATS,
      transactions: [EXPENSE_TX],
    });
    const [control] = screen.getAllByRole("button", { name: /^Delete / });

    const token = textTokenClass(control);
    expect(token).not.toBeNull();
    for (const theme of ["light", "dark"] as const) {
      expect(
        contrastRatio(tokenHex(token!, theme), tokenHex("surface", theme)),
        `${token} on surface, ${theme}`,
      ).toBeGreaterThanOrEqual(MIN_UI_CONTRAST);
    }
    expect(control.className).toMatch(/min-h-6/);
    expect(control.className).toMatch(/min-w-6/);
  });
});
