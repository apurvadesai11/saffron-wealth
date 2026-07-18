import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AccountEditModal from "./AccountEditModal";
import type { Account } from "@/lib/types";

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: "acc-1",
    name: "Fidelity Brokerage",
    type: "brokerage",
    institution: "Fidelity",
    balance: 10000,
    balanceAsOf: "2026-07-17T00:00:00.000Z",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
    ...overrides,
  };
}

describe("AccountEditModal — add mode", () => {
  it("shows 'Add Account' title and an empty form", () => {
    render(<AccountEditModal onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Add Account" })).toBeInTheDocument();
    expect(screen.getByLabelText("Account name")).toHaveValue("");
  });

  it("groups the type select into optgroups by bucket", () => {
    render(<AccountEditModal onSave={vi.fn()} onClose={vi.fn()} />);
    const select = screen.getByLabelText("Type") as HTMLSelectElement;
    const groupLabels = Array.from(select.querySelectorAll("optgroup")).map((g) => g.label);
    expect(groupLabels).toEqual(["Cash", "Investments", "Retirement", "Real Estate", "Debt"]);
  });

  it("rejects an empty name", async () => {
    const onSave = vi.fn();
    render(<AccountEditModal onSave={onSave} onClose={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Balance"), "100");
    await userEvent.click(screen.getByRole("button", { name: "Add Account" }));
    expect(screen.getByText(/Account name is required/)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("rejects a negative or missing balance", async () => {
    const onSave = vi.fn();
    render(<AccountEditModal onSave={onSave} onClose={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Account name"), "New Account");
    await userEvent.click(screen.getByRole("button", { name: "Add Account" }));
    expect(screen.getByText(/Enter a valid amount/)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("calls onSave with the normalized payload on valid input", async () => {
    const onSave = vi.fn();
    render(<AccountEditModal onSave={onSave} onClose={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Account name"), "  My Brokerage  ");
    await userEvent.selectOptions(screen.getByLabelText("Type"), "brokerage");
    await userEvent.type(screen.getByLabelText(/Institution/), "  Vanguard  ");
    await userEvent.type(screen.getByLabelText("Balance"), "5000");
    await userEvent.click(screen.getByRole("button", { name: "Add Account" }));

    expect(onSave).toHaveBeenCalledWith({
      name: "My Brokerage",
      type: "brokerage",
      institution: "Vanguard",
      balance: 5000,
    });
  });

  it("normalizes a blank institution to null", async () => {
    const onSave = vi.fn();
    render(<AccountEditModal onSave={onSave} onClose={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Account name"), "Cash");
    await userEvent.type(screen.getByLabelText("Balance"), "100");
    await userEvent.click(screen.getByRole("button", { name: "Add Account" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ institution: null }));
  });
});

describe("AccountEditModal — edit mode", () => {
  it("prefills all fields, including type, from the existing account", () => {
    render(<AccountEditModal account={account()} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("Edit Account")).toBeInTheDocument();
    expect(screen.getByLabelText("Account name")).toHaveValue("Fidelity Brokerage");
    expect(screen.getByLabelText("Type")).toHaveValue("brokerage");
    expect(screen.getByLabelText(/Institution/)).toHaveValue("Fidelity");
    expect(screen.getByLabelText("Balance")).toHaveValue(10000);
  });

  it("allows changing the type in edit mode", async () => {
    const onSave = vi.fn();
    render(<AccountEditModal account={account()} onSave={onSave} onClose={vi.fn()} />);
    await userEvent.selectOptions(screen.getByLabelText("Type"), "credit_card");
    await userEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ type: "credit_card" }));
  });
});

describe("AccountEditModal — dismissal", () => {
  it("calls onClose when the backdrop is clicked", async () => {
    const onClose = vi.fn();
    render(<AccountEditModal onSave={vi.fn()} onClose={onClose} />);
    await userEvent.click(screen.getByLabelText("Close modal"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on Escape", async () => {
    const onClose = vi.fn();
    render(<AccountEditModal onSave={vi.fn()} onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
