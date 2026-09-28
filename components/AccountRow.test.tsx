import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AccountRow from "./AccountRow";
import { contrastRatio, textGrayClass, TAILWIND_GRAY, WHITE } from "./__tests__/contrast";
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
    render(<AccountRow account={account()} onEdit={vi.fn()} onArchive={vi.fn()} />);
    expect(screen.getByText("Fidelity Brokerage")).toBeInTheDocument();
    const subline = screen.getByText(/as of 2026-07-17/);
    expect(subline.textContent).toMatch(/Brokerage/);
    expect(subline.textContent).toMatch(/Fidelity/);
    expect(screen.getByText("$10000.00")).toBeInTheDocument();
  });

  it("omits the institution segment when none is set", () => {
    render(<AccountRow account={account({ institution: null })} onEdit={vi.fn()} onArchive={vi.fn()} />);
    const subline = screen.getByText(/as of/);
    expect(subline.textContent).not.toMatch(/Fidelity/);
  });

  it("marks liability accounts with data-liability=true and red balance", () => {
    const { container } = render(
      <AccountRow account={account({ type: "credit_card", balance: 2000 })} onEdit={vi.fn()} onArchive={vi.fn()} />,
    );
    expect(container.querySelector('[data-liability="true"]')).toBeInTheDocument();
    expect(screen.getByText("$2000.00").className).toMatch(/text-red-600/);
  });

  it("marks asset accounts with data-liability=false", () => {
    const { container } = render(<AccountRow account={account()} onEdit={vi.fn()} onArchive={vi.fn()} />);
    expect(container.querySelector('[data-liability="false"]')).toBeInTheDocument();
  });

  it("calls onEdit when the row is clicked", async () => {
    const onEdit = vi.fn();
    render(<AccountRow account={account()} onEdit={onEdit} onArchive={vi.fn()} />);
    await userEvent.click(screen.getByText("Fidelity Brokerage"));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

});

// 14a/14b — the control was a bare "✕" at roughly a 10px hit target, sitting
// immediately next to the row's edit button, and it fired on the first click.
// It also said "Delete" while archiveAccount only ever sets archivedAt, so the
// label described something the app does not do.
describe("AccountRow archive confirmation", () => {
  it("names the action archive, not delete", () => {
    render(<AccountRow account={account()} onEdit={vi.fn()} onArchive={vi.fn()} />);

    expect(
      screen.getByRole("button", { name: /Archive Fidelity Brokerage/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete/ })).not.toBeInTheDocument();
  });

  it("does not archive on the first click", async () => {
    const onArchive = vi.fn();
    render(<AccountRow account={account()} onEdit={vi.fn()} onArchive={onArchive} />);

    await userEvent.click(screen.getByRole("button", { name: /Archive Fidelity Brokerage/ }));

    expect(onArchive).not.toHaveBeenCalled();
    expect(screen.getByText("Archive?")).toBeInTheDocument();
  });

  it("archives once the confirm is clicked", async () => {
    const onArchive = vi.fn();
    render(<AccountRow account={account()} onEdit={vi.fn()} onArchive={onArchive} />);

    await userEvent.click(screen.getByRole("button", { name: /Archive Fidelity Brokerage/ }));
    await userEvent.click(screen.getByRole("button", { name: /^Yes, archive/ }));

    expect(onArchive).toHaveBeenCalledTimes(1);
  });

  it("abandons the archive on cancel", async () => {
    const onArchive = vi.fn();
    render(<AccountRow account={account()} onEdit={vi.fn()} onArchive={onArchive} />);

    await userEvent.click(screen.getByRole("button", { name: /Archive Fidelity Brokerage/ }));
    await userEvent.click(screen.getByRole("button", { name: /Cancel/ }));

    expect(onArchive).not.toHaveBeenCalled();
    expect(screen.queryByText("Archive?")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Archive Fidelity Brokerage/ }),
    ).toBeInTheDocument();
  });

  // Recoverable, and the row stays visible with a working Restore path — so
  // the confirm says what happens rather than warning about danger.
  it("tells the user the account is kept, not removed", async () => {
    render(<AccountRow account={account()} onEdit={vi.fn()} onArchive={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Archive Fidelity Brokerage/ }));

    expect(screen.getByRole("button", { name: /^Yes, archive/ })).toBeInTheDocument();
  });

  it("marks the confirm state with a data attribute so styling is not the signal", async () => {
    const { container } = render(
      <AccountRow account={account()} onEdit={vi.fn()} onArchive={vi.fn()} />,
    );
    expect(container.querySelector('[data-confirming="true"]')).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /Archive Fidelity Brokerage/ }));

    expect(container.querySelector('[data-confirming="true"]')).toBeInTheDocument();
  });
});

// Account.balance can legitimately be negative now: an overdrawn asset, and a
// debt account carrying a statement credit (a negative amount owed). The
// balance import used to clamp both away, which read a $500 credit as $500
// owed and disagreed with the chart by $1,000.
describe("AccountRow negative balances", () => {
  it("renders an overdrawn asset with the minus outside the dollar sign", () => {
    render(<AccountRow account={account({ type: "cash", balance: -50 })} onEdit={vi.fn()} onArchive={vi.fn()} />);

    expect(screen.getByText("-$50.00")).toBeInTheDocument();
  });

  // "-$500.00" inside a group labelled Debt is ambiguous: it reads as either
  // "owes 500" or "is owed 500" depending on which convention you assume.
  it("labels a credited debt balance as a credit rather than a negative", () => {
    render(
      <AccountRow
        account={account({ type: "credit_card", balance: -500 })}
        onEdit={vi.fn()}
        onArchive={vi.fn()}
      />,
    );

    expect(screen.getByText("$500.00 credit")).toBeInTheDocument();
  });

  it("shows a credited debt balance in the same colour as an asset, since it adds to net worth", () => {
    const { container } = render(
      <AccountRow
        account={account({ type: "credit_card", balance: -500 })}
        onEdit={vi.fn()}
        onArchive={vi.fn()}
      />,
    );

    const amount = container.querySelector("[data-balance-sign]");
    expect(amount?.getAttribute("data-balance-sign")).toBe("credit");
  });
});

// 14b — `text-gray-300` on white is about 1.5:1. WCAG 2.1 SC 1.4.11 requires
// 3:1 for a non-text UI control. The aria-label was already correct, so
// screen-reader users were better served here than sighted mouse users.
//
// Asserted as a computed ratio rather than "the class changed", so the test
// states the requirement instead of restating the implementation.
const MIN_UI_CONTRAST = 3;

describe("AccountRow control contrast", () => {
  it("the archive control clears WCAG 1.4.11's 3:1 for non-text controls", () => {
    render(<AccountRow account={account()} onEdit={vi.fn()} onArchive={vi.fn()} />);
    const control = screen.getByRole("button", { name: /Archive Fidelity Brokerage/ });

    const cls = textGrayClass(control);
    expect(cls).not.toBeNull();
    const hex = TAILWIND_GRAY[cls!];
    expect(hex, `no palette entry for ${cls}`).toBeDefined();
    expect(contrastRatio(hex, WHITE)).toBeGreaterThanOrEqual(MIN_UI_CONTRAST);
  });

  it("reserves at least a 24x24 CSS-pixel hit target", () => {
    render(<AccountRow account={account()} onEdit={vi.fn()} onArchive={vi.fn()} />);
    const control = screen.getByRole("button", { name: /Archive Fidelity Brokerage/ });

    // happy-dom has no layout, so the reserved size is asserted through the
    // sizing classes; e2e/accessibility.spec.ts measures the real box.
    expect(control.className).toMatch(/min-h-6/);
    expect(control.className).toMatch(/min-w-6/);
  });
});

// The plan asks for TransactionList's delete control to be audited for the
// same two issues, since it is the same pattern.
describe("contrast arithmetic sanity", () => {
  it("agrees with the published ratios for the greys in play", () => {
    // The value the audit reported for the old control.
    expect(contrastRatio(TAILWIND_GRAY["gray-300"], WHITE)).toBeLessThan(MIN_UI_CONTRAST);
    expect(contrastRatio(TAILWIND_GRAY["gray-400"], WHITE)).toBeLessThan(MIN_UI_CONTRAST);
    expect(contrastRatio(TAILWIND_GRAY["gray-500"], WHITE)).toBeGreaterThanOrEqual(MIN_UI_CONTRAST);
  });
});
