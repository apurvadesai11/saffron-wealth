import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AccountRow from "./AccountRow";
import type { Account } from "@/lib/types";

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: "acc-1",
    name: "Fidelity Brokerage",
    type: "brokerage",
    institution: "Fidelity",
    balance: 10000,
    balanceAsOf: "2026-07-17T12:00:00.000Z",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-17T12:00:00.000Z",
    ...overrides,
  };
}

describe("AccountRow", () => {
  it("shows name, type label, institution, balance, and as-of date", () => {
    render(<AccountRow account={account()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText("Fidelity Brokerage")).toBeInTheDocument();
    const subline = screen.getByText(/as of 2026-07-17/);
    expect(subline.textContent).toMatch(/Brokerage/);
    expect(subline.textContent).toMatch(/Fidelity/);
    expect(screen.getByText("$10000.00")).toBeInTheDocument();
  });

  it("omits the institution segment when none is set", () => {
    render(<AccountRow account={account({ institution: null })} onEdit={vi.fn()} onDelete={vi.fn()} />);
    const subline = screen.getByText(/as of/);
    expect(subline.textContent).not.toMatch(/Fidelity/);
  });

  it("marks liability accounts with data-liability=true and red balance", () => {
    const { container } = render(
      <AccountRow account={account({ type: "credit_card", balance: 2000 })} onEdit={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(container.querySelector('[data-liability="true"]')).toBeInTheDocument();
    expect(screen.getByText("$2000.00").className).toMatch(/text-red-600/);
  });

  it("marks asset accounts with data-liability=false", () => {
    const { container } = render(<AccountRow account={account()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(container.querySelector('[data-liability="false"]')).toBeInTheDocument();
  });

  it("calls onEdit when the row is clicked", async () => {
    const onEdit = vi.fn();
    render(<AccountRow account={account()} onEdit={onEdit} onDelete={vi.fn()} />);
    await userEvent.click(screen.getByText("Fidelity Brokerage"));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("calls onDelete when the delete button is clicked", async () => {
    const onDelete = vi.fn();
    render(<AccountRow account={account()} onEdit={vi.fn()} onDelete={onDelete} />);
    await userEvent.click(screen.getByRole("button", { name: /Delete Fidelity Brokerage/ }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
