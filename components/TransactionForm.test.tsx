import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TransactionForm from "./TransactionForm";
import { useApp } from "@/lib/app-context";
import type { Category, Transaction } from "@/lib/types";
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

describe("TransactionForm — editing a transaction", () => {
  const CAT_CARD_PAYMENT: Category = {
    id: "cat-card-payment", name: "Credit Card Payment", type: "transfer", color: "bg-gray-500",
  };

  const groceryRun: Transaction = {
    id: "tx-1", description: "Fresh Grocer", amount: 84.5, categoryId: CAT_GROCERIES.id,
    type: "expense", date: "2026-07-01", accountId: "acc-1", merchant: "Fresh Grocer", notes: null,
  };

  // Reads the context the form writes to, so the tests assert on the saved
  // result rather than on a spy.
  function Rows() {
    const { transactions } = useApp();
    return (
      <ul>
        {transactions.map((t) => (
          <li key={t.id} data-testid="row">{`${t.id}|${t.description}|${t.amount}|${t.categoryId}|${t.date}|${t.accountId}`}</li>
        ))}
      </ul>
    );
  }

  async function submitEdit() {
    const form = screen.getByRole("button", { name: "Save Changes" }).closest("form");
    if (!form) throw new Error("Form not found");
    await act(async () => {
      fireEvent.submit(form);
    });
  }

  it("prefills every field from the transaction and labels the button Save Changes", () => {
    renderWithApp(<TransactionForm transaction={groceryRun} />, { categories: CATS, transactions: [groceryRun] });

    expect(screen.getByLabelText("Type")).toHaveValue("expense");
    expect(screen.getByLabelText("Category")).toHaveValue(CAT_GROCERIES.id);
    expect(screen.getByLabelText("Description")).toHaveValue("Fresh Grocer");
    expect(screen.getByLabelText("Amount ($)")).toHaveValue(84.5);
    expect(screen.getByLabelText("Date")).toHaveValue("2026-07-01");
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeInTheDocument();
  });

  it("saves the edits to the same transaction instead of adding one, and reports it", async () => {
    const onSubmitted = vi.fn();
    renderWithApp(
      <>
        <TransactionForm transaction={groceryRun} onSubmitted={onSubmitted} />
        <Rows />
      </>,
      { categories: CATS, transactions: [groceryRun] },
    );

    await userEvent.clear(screen.getByLabelText("Description"));
    await userEvent.type(screen.getByLabelText("Description"), "Weekly shop");
    await userEvent.clear(screen.getByLabelText("Amount ($)"));
    await userEvent.type(screen.getByLabelText("Amount ($)"), "1234.56");
    await userEvent.selectOptions(screen.getByLabelText("Category"), CAT_RENT.id);
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-07-02" } });
    await submitEdit();

    expect(onSubmitted).toHaveBeenCalledTimes(1);
    const rows = screen.getAllByTestId("row");
    expect(rows).toHaveLength(1);
    // accountId comes from the import and the form has no input for it.
    expect(rows[0]).toHaveTextContent(`tx-1|Weekly shop|1234.56|${CAT_RENT.id}|2026-07-02|acc-1`);
  });

  it("keeps the edited values on screen after saving", async () => {
    renderWithApp(<TransactionForm transaction={groceryRun} />, { categories: CATS, transactions: [groceryRun] });

    await userEvent.clear(screen.getByLabelText("Description"));
    await userEvent.type(screen.getByLabelText("Description"), "Weekly shop");
    await submitEdit();

    expect(screen.getByLabelText("Description")).toHaveValue("Weekly shop");
  });

  it("offers Transfer, and keeps a transfer's category, when editing a transfer", () => {
    const payment: Transaction = {
      ...groceryRun, id: "tx-2", description: "Card payment", type: "transfer", categoryId: CAT_CARD_PAYMENT.id,
    };
    renderWithApp(<TransactionForm transaction={payment} />, {
      categories: [...CATS, CAT_CARD_PAYMENT],
      transactions: [payment],
    });

    expect(screen.getByLabelText("Type")).toHaveValue("transfer");
    expect(screen.getByLabelText("Category")).toHaveValue(CAT_CARD_PAYMENT.id);
  });

  it("lets an imported expense be recategorized as a transfer", async () => {
    renderWithApp(<TransactionForm transaction={groceryRun} />, {
      categories: [...CATS, CAT_CARD_PAYMENT],
      transactions: [groceryRun],
    });

    await userEvent.selectOptions(screen.getByLabelText("Type"), "transfer");
    expect(screen.getByLabelText("Category")).toHaveValue(CAT_CARD_PAYMENT.id);
  });

  it("does not offer Transfer on the add form", () => {
    renderWithApp(<TransactionForm />, { categories: [...CATS, CAT_CARD_PAYMENT] });

    expect(screen.queryByRole("option", { name: "Transfer" })).not.toBeInTheDocument();
  });

  // A category that has since left the list (archived) is still the row's
  // real category. Showing the first option instead would display one value
  // while submitting another.
  it("keeps a category the list no longer offers selected", () => {
    const orphaned: Transaction = { ...groceryRun, categoryId: "cat-archived" };
    renderWithApp(<TransactionForm transaction={orphaned} />, { categories: CATS, transactions: [orphaned] });

    expect(screen.getByLabelText("Category")).toHaveValue("cat-archived");
  });
});
