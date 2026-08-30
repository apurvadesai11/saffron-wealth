import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TransactionForm from "./TransactionForm";
import {
  renderWithApp,
  CAT_GROCERIES,
  CAT_RENT,
  CAT_SALARY,
} from "./__tests__/test-utils";

const CATS = [CAT_GROCERIES, CAT_RENT, CAT_SALARY];

// happy-dom doesn't always fire form `submit` from a button click, so we
// dispatch the form's submit event directly. Same effect as Enter / button
// click in a real browser, but bypasses the happy-dom inconsistency.
// handleSubmit is async (it awaits addTransaction), so this must be awaited
// through async act() to flush the state update before assertions run.
async function submitForm() {
  const form = screen
    .getByRole("button", { name: /Save Transaction/i })
    .closest("form");
  if (!form) throw new Error("Form not found");
  await act(async () => {
    fireEvent.submit(form);
  });
}

describe("TransactionForm", () => {
  it("defaults to expense type and the first expense category", () => {
    renderWithApp(<TransactionForm />, { categories: CATS });
    expect(screen.getByLabelText("Type")).toHaveValue("expense");
    expect(screen.getByLabelText("Category")).toHaveValue(CAT_GROCERIES.id);
  });

  it("repopulates the category dropdown when type switches", async () => {
    renderWithApp(<TransactionForm />, { categories: CATS });
    await userEvent.selectOptions(screen.getByLabelText("Type"), "income");
    expect(screen.getByLabelText("Category")).toHaveValue(CAT_SALARY.id);
  });

  it("clears description and amount on successful submit and calls onSubmitted", async () => {
    const onSubmitted = vi.fn();
    renderWithApp(<TransactionForm onSubmitted={onSubmitted} />, {
      categories: CATS,
      transactions: [],
    });

    await userEvent.type(screen.getByLabelText("Description"), "Coffee");
    await userEvent.type(screen.getByLabelText("Amount ($)"), "4.50");
    await submitForm();

    expect(onSubmitted).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Description")).toHaveValue("");
    expect(screen.getByLabelText("Amount ($)")).toHaveValue(null);
  });

  it("does NOT submit when amount is zero (handleSubmit bails before addTransaction)", async () => {
    const onSubmitted = vi.fn();
    renderWithApp(<TransactionForm onSubmitted={onSubmitted} />, {
      categories: CATS,
      transactions: [],
    });

    await userEvent.type(screen.getByLabelText("Description"), "Bogus");
    // 0 fails the explicit handleSubmit guard (parsedAmount <= 0).
    await userEvent.type(screen.getByLabelText("Amount ($)"), "0");
    await submitForm();

    expect(onSubmitted).not.toHaveBeenCalled();
  });

  it("does NOT submit when amount is missing entirely", async () => {
    const onSubmitted = vi.fn();
    renderWithApp(<TransactionForm onSubmitted={onSubmitted} />, {
      categories: CATS,
      transactions: [],
    });
    await userEvent.type(screen.getByLabelText("Description"), "Bogus");
    await submitForm();
    expect(onSubmitted).not.toHaveBeenCalled();
  });
});
