import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TransactionEditModal from "./TransactionEditModal";
import { renderWithApp, CAT_GROCERIES, CAT_SALARY } from "./__tests__/test-utils";
import type { Transaction } from "@/lib/types";

const TX: Transaction = {
  id: "tx-1",
  description: "Fresh Grocer",
  amount: 84.5,
  categoryId: CAT_GROCERIES.id,
  type: "expense",
  date: "2026-07-01",
};

function renderModal(onClose = vi.fn()) {
  renderWithApp(<TransactionEditModal transaction={TX} onClose={onClose} />, {
    categories: [CAT_GROCERIES, CAT_SALARY],
    transactions: [TX],
  });
  return onClose;
}

describe("TransactionEditModal", () => {
  it("opens as a dialog titled Edit Transaction with the transaction filled in", () => {
    renderModal();

    expect(screen.getByRole("dialog", { name: "Edit Transaction" })).toBeInTheDocument();
    expect(screen.getByLabelText("Description")).toHaveValue("Fresh Grocer");
  });

  it("closes once the edit is saved", async () => {
    const onClose = renderModal();

    const form = screen.getByRole("button", { name: "Save Changes" }).closest("form")!;
    await act(async () => {
      fireEvent.submit(form);
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape and on the close button without saving", async () => {
    const onClose = renderModal();

    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
