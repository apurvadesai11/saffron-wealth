import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BudgetCategoryRow from "./BudgetCategoryRow";
import type { BudgetProgress } from "@/lib/types";

function progress(overrides: Partial<BudgetProgress> = {}): BudgetProgress {
  return {
    categoryId: "cat-1",
    categoryName: "Groceries",
    categoryType: "expense",
    budgetAmount: 500,
    spent: 250,
    percent: 50,
    barColor: "green",
    isHidden: false,
    ...overrides,
  };
}

describe("BudgetCategoryRow", () => {
  it("shows '$X left' for an expense category under budget", () => {
    render(<BudgetCategoryRow progress={progress({ spent: 250, budgetAmount: 500 })} />);
    expect(screen.getByText(/\$250 left/)).toBeInTheDocument();
    expect(screen.getByText(/50% used/)).toBeInTheDocument();
  });

  it("shows '$X over budget' and over-budget data attribute for an expense category over budget", () => {
    const { container } = render(
      <BudgetCategoryRow
        progress={progress({ spent: 600, budgetAmount: 500, percent: 120, barColor: "deep-red" })}
      />,
    );
    expect(screen.getByText(/\$100 over budget/)).toBeInTheDocument();
    expect(container.querySelector('[data-over-budget="true"]')).toBeInTheDocument();
  });

  it("uses 'remaining' (not 'left') for income under target", () => {
    render(
      <BudgetCategoryRow
        progress={progress({ categoryType: "income", spent: 800, budgetAmount: 1000, percent: 80 })}
      />,
    );
    expect(screen.getByText(/\$200 remaining/)).toBeInTheDocument();
    expect(screen.queryByText(/left/)).not.toBeInTheDocument();
  });

  it("uses 'surplus' for income that exceeded its target", () => {
    render(
      <BudgetCategoryRow
        progress={progress({ categoryType: "income", spent: 1200, budgetAmount: 1000, percent: 120 })}
      />,
    );
    expect(screen.getByText(/\$200 surplus/)).toBeInTheDocument();
  });

  it("hides amount line and sub-row when isHidden", () => {
    const { container } = render(
      <BudgetCategoryRow progress={progress({ isHidden: true, budgetAmount: 0, spent: 0, percent: 0 })} />,
    );
    expect(screen.queryByText(/used/)).not.toBeInTheDocument();
    expect(screen.queryByText(/left/)).not.toBeInTheDocument();
    expect(container.querySelector('[data-hidden="true"]')).toBeInTheDocument();
    expect(screen.getByText("Hidden from Budgets")).toBeInTheDocument();
  });

  it("renders as a button and calls onEdit when clicked", async () => {
    const onEdit = vi.fn();
    render(<BudgetCategoryRow progress={progress()} onEdit={onEdit} />);
    await userEvent.click(screen.getByRole("button", { name: /Groceries/ }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("renders as a non-interactive item without onEdit", () => {
    render(<BudgetCategoryRow progress={progress()} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    // Chevron only renders when onEdit is provided.
    expect(screen.queryByText("›")).not.toBeInTheDocument();
  });

  it("uses '% received' suffix for income categories", () => {
    render(
      <BudgetCategoryRow
        progress={progress({ categoryType: "income", percent: 75 })}
      />,
    );
    expect(screen.getByText(/75% received/)).toBeInTheDocument();
    expect(screen.queryByText(/used/)).not.toBeInTheDocument();
  });
});
