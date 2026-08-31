import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ArchivedAccountsGroup from "./ArchivedAccountsGroup";
import type { Account } from "@/lib/types";

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: "acc-1",
    name: "Legacy Brokerage",
    type: "brokerage",
    institution: "Fidelity",
    balance: 5200,
    balanceAsOf: "2026-01-02T00:00:00.000Z",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("ArchivedAccountsGroup", () => {
  it("renders nothing when there are no archived accounts", () => {
    const { container } = render(<ArchivedAccountsGroup accounts={[]} onRestore={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the archived count, account name, type, and balance", () => {
    render(<ArchivedAccountsGroup accounts={[account()]} onRestore={vi.fn()} />);
    expect(screen.getByText("Archived (1)")).toBeInTheDocument();
    expect(screen.getByText("Legacy Brokerage")).toBeInTheDocument();
    expect(screen.getByText("$5200.00")).toBeInTheDocument();
  });

  it("calls onRestore with the account when Restore is clicked", async () => {
    const onRestore = vi.fn();
    const acc = account();
    render(<ArchivedAccountsGroup accounts={[acc]} onRestore={onRestore} />);
    await userEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onRestore).toHaveBeenCalledWith(acc);
  });

  it("lists every archived account passed in", () => {
    render(
      <ArchivedAccountsGroup
        accounts={[account({ id: "a", name: "Old Checking" }), account({ id: "b", name: "Old 401k" })]}
        onRestore={vi.fn()}
      />,
    );
    expect(screen.getByText("Archived (2)")).toBeInTheDocument();
    expect(screen.getByText("Old Checking")).toBeInTheDocument();
    expect(screen.getByText("Old 401k")).toBeInTheDocument();
  });
});
