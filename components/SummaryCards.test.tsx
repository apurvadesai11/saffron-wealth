import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import SummaryCards from "./SummaryCards";
import { renderWithApp, CAT_GROCERIES, CAT_SALARY } from "./__tests__/test-utils";
import type { Transaction } from "@/lib/types";

describe("SummaryCards", () => {
  it("renders totals and a positive balance when income > expenses", () => {
    const transactions: Transaction[] = [
      { id: "1", description: "Pay", amount: 3000, categoryId: CAT_SALARY.id, type: "income", date: "2026-05-01" },
      { id: "2", description: "Rent", amount: 1200, categoryId: CAT_GROCERIES.id, type: "expense", date: "2026-05-02" },
    ];
    renderWithApp(<SummaryCards />, {
      categories: [CAT_GROCERIES, CAT_SALARY],
      transactions,
    });

    expect(screen.getByText("$1800.00")).toBeInTheDocument(); // Balance
    expect(screen.getByText("$3000.00")).toBeInTheDocument(); // Income
    expect(screen.getByText("$1200.00")).toBeInTheDocument(); // Expenses
  });

  it("uses red text for a negative balance when expenses > income", () => {
    const transactions: Transaction[] = [
      { id: "1", description: "Pay", amount: 1000, categoryId: CAT_SALARY.id, type: "income", date: "2026-05-01" },
      { id: "2", description: "Rent", amount: 2000, categoryId: CAT_GROCERIES.id, type: "expense", date: "2026-05-02" },
    ];
    renderWithApp(<SummaryCards />, {
      categories: [CAT_GROCERIES, CAT_SALARY],
      transactions,
    });

    const balance = screen.getByText("$-1000.00");
    expect(balance).toBeInTheDocument();
    expect(balance.className).toMatch(/text-red-600/);
  });
});
