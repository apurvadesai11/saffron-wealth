import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import BudgetProgressBar from "./BudgetProgressBar";
import type { ExpenseBarColor, IncomeBarColor } from "@/lib/types";

describe("BudgetProgressBar", () => {
  it("renders 'Hidden from Budgets' label when isHidden", () => {
    const { container } = render(
      <BudgetProgressBar percent={50} color="green" isHidden={true} />,
    );
    expect(screen.getByText("Hidden from Budgets")).toBeInTheDocument();
    expect(container.querySelector('[data-state="hidden"]')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="budget-progress-bar"]')).toBeNull();
  });

  it("renders the bar with the requested width when not hidden", () => {
    const { container } = render(
      <BudgetProgressBar percent={50} color="green" isHidden={false} />,
    );
    const fill = container.querySelector('[data-state="green"]') as HTMLElement;
    expect(fill).toBeInTheDocument();
    expect(fill.style.width).toBe("50%");
  });

  it.each<ExpenseBarColor | IncomeBarColor>([
    "green", "yellow", "orange", "red", "deep-red",
  ])("sets data-state=%s when color=%s", (color) => {
    const { container } = render(
      <BudgetProgressBar percent={75} color={color} isHidden={false} />,
    );
    expect(container.querySelector(`[data-state="${color}"]`)).toBeInTheDocument();
  });

  it("caps visual width at 100% even when percent > 100", () => {
    const { container } = render(
      <BudgetProgressBar percent={125} color="deep-red" isHidden={false} />,
    );
    const fill = container.querySelector('[data-state="deep-red"]') as HTMLElement;
    expect(fill.style.width).toBe("100%");
  });

  it("renders 0% width when percent is 0", () => {
    const { container } = render(
      <BudgetProgressBar percent={0} color="green" isHidden={false} />,
    );
    const fill = container.querySelector('[data-state="green"]') as HTMLElement;
    expect(fill.style.width).toBe("0%");
  });
});
