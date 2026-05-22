import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BudgetEditModal from "./BudgetEditModal";
import type { Category, Budget } from "@/lib/types";

const CAT: Category = { id: "cat-1", name: "Groceries", type: "expense", color: "bg-green-500" };
const BUDGET: Budget = { categoryId: "cat-1", amount: 500, period: "monthly" };

function renderModal(overrides: Partial<{
  category: Category;
  currentBudget: Budget | undefined;
  historicalAverage: { average: number; periodsOfData: number } | null;
  onSave: (amount: number) => void;
  onClose: () => void;
}> = {}) {
  const onSave = overrides.onSave ?? vi.fn();
  const onClose = overrides.onClose ?? vi.fn();
  const utils = render(
    <BudgetEditModal
      category={overrides.category ?? CAT}
      currentBudget={"currentBudget" in overrides ? overrides.currentBudget : BUDGET}
      historicalAverage={"historicalAverage" in overrides ? overrides.historicalAverage! : null}
      onSave={onSave}
      onClose={onClose}
    />,
  );
  return { ...utils, onSave, onClose };
}

describe("BudgetEditModal", () => {
  it("prefills the input with the current budget amount", () => {
    renderModal({ currentBudget: { ...BUDGET, amount: 350 } });
    expect(screen.getByLabelText(/Monthly budget amount/i)).toHaveValue(350);
  });

  it("autofocuses the input on open", () => {
    renderModal();
    expect(screen.getByLabelText(/Monthly budget amount/i)).toHaveFocus();
  });

  it("calls onClose when Escape is pressed", async () => {
    const { onClose } = renderModal();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the backdrop is clicked but NOT when the card is clicked", async () => {
    const { onClose } = renderModal();
    // Click inside the card — should NOT close.
    await userEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();

    // Click on the backdrop (the labelled close region wrapping the card).
    await userEvent.click(screen.getByLabelText("Close modal"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows a validation error and does not call onSave when input is empty", async () => {
    const { onSave } = renderModal({ currentBudget: undefined });
    await userEvent.click(screen.getByRole("button", { name: /Save Budget/i }));
    expect(screen.getByText(/Please enter a budget amount/i)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("calls onSave with the rounded integer when input is valid", async () => {
    const { onSave } = renderModal({ currentBudget: undefined });
    const input = screen.getByLabelText(/Monthly budget amount/i);
    await userEvent.type(input, "247.83");
    await userEvent.click(screen.getByRole("button", { name: /Save Budget/i }));
    expect(onSave).toHaveBeenCalledWith(248);
  });

  it("shows the amber 'Hidden from Budgets' hint when value is 0", async () => {
    renderModal({ currentBudget: undefined });
    const input = screen.getByLabelText(/Monthly budget amount/i);
    await userEvent.type(input, "0");
    expect(screen.getByText(/will be marked/i)).toBeInTheDocument();
  });

  it("'Use this →' button copies the rounded historical average into the input", async () => {
    renderModal({
      currentBudget: undefined,
      historicalAverage: { average: 412.7, periodsOfData: 6 },
    });
    await userEvent.click(screen.getByRole("button", { name: /Use this/i }));
    expect(screen.getByLabelText(/Monthly budget amount/i)).toHaveValue(413);
  });
});
