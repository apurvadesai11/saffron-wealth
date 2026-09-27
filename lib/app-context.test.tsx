// Targets the seed-sync guard in AppProvider directly (see the long comment
// above it in app-context.tsx). This exists because the guard's whole
// purpose only shows up across a *changed seed prop reference* — every other
// test in the repo either holds seeds stable (renderWithApp) or imports with
// no prior mutation (e2e/monarch-import.spec.ts), so neither ever exercises
// the mut !== baseline branch. A prior version of this guard shipped with a
// baseline bug that passed the full suite anyway, precisely because nothing
// re-rendered the provider with a new seed reference.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppProvider, useApp } from "./app-context";
import type { Transaction } from "./types";

function tx(id: string): Transaction {
  return {
    id,
    description: `Tx ${id}`,
    amount: 10,
    categoryId: "cat-1",
    type: "expense",
    date: "2026-01-01",
  };
}

// A minimal consumer exposing just enough of useApp() to drive and observe
// the guard: transactions (to see which seed "won"), and the three actions
// that can move it — a mutation, and beginRefresh.
function Harness() {
  const { transactions, addTransaction, deleteTransaction, beginRefresh } = useApp();
  return (
    <div>
      <p data-testid="tx-ids">{transactions.map(t => t.id).join(",")}</p>
      <button onClick={() => void addTransaction({
        description: "New tx",
        amount: 5,
        categoryId: "cat-1",
        type: "expense",
        date: "2026-01-02",
      })}>
        add
      </button>
      <button onClick={() => void deleteTransaction(transactions[0]?.id)}>delete-first</button>
      <button onClick={beginRefresh}>begin-refresh</button>
    </div>
  );
}

function ids() {
  return screen.getByTestId("tx-ids").textContent;
}

describe("AppProvider — seed-sync guard", () => {
  it("adopts a clean seed change with no local mutations and no beginRefresh call", () => {
    const seedA = [tx("a1"), tx("a2")];
    const seedB = [tx("b1"), tx("b2"), tx("b3")];
    const { rerender } = render(
      <AppProvider seedTransactions={seedA} offline><Harness /></AppProvider>,
    );
    expect(ids()).toBe("a1,a2");

    rerender(<AppProvider seedTransactions={seedB} offline><Harness /></AppProvider>);
    expect(ids()).toBe("b1,b2,b3");
  });

  it("skips a seed that a later mutation raced ahead of", async () => {
    const seedA = [tx("a1"), tx("a2")];
    const seedB = [tx("b1"), tx("b2")];
    const { rerender } = render(
      <AppProvider seedTransactions={seedA} offline><Harness /></AppProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "begin-refresh" }));
    // A mutation happens AFTER the refresh was "requested" — races ahead of
    // whatever snapshot the eventual seed represents.
    await userEvent.click(screen.getByRole("button", { name: "delete-first" }));
    expect(ids()).toBe("a2");

    rerender(<AppProvider seedTransactions={seedB} offline><Harness /></AppProvider>);
    // The stale seed is skipped — the more recent local delete stands.
    expect(ids()).toBe("a2");
  });

  it("adopts a seed that arrives after an unrelated EARLIER mutation (the regression)", async () => {
    const seedA = [tx("a1"), tx("a2")];
    const seedB = [tx("b1"), tx("b2"), tx("b3")];
    const { rerender } = render(
      <AppProvider seedTransactions={seedA} offline><Harness /></AppProvider>,
    );

    // Mutation happens BEFORE the refresh is even requested — e.g. a budget
    // edit on the dashboard minutes before the user opens the import modal.
    await userEvent.click(screen.getByRole("button", { name: "add" }));
    await userEvent.click(screen.getByRole("button", { name: "begin-refresh" }));

    rerender(<AppProvider seedTransactions={seedB} offline><Harness /></AppProvider>);
    // beginRefresh() snapshots the CURRENT (already-mutated) version, so
    // nothing races it — the fresh seed must still win. A baseline captured
    // at "last seed change" instead of "refresh requested" would fail this.
    expect(ids()).toBe("b1,b2,b3");
  });

  it("adopts two consecutive clean seeds without latching", async () => {
    const seedA = [tx("a1")];
    const seedB = [tx("b1")];
    const seedC = [tx("c1")];
    const { rerender } = render(
      <AppProvider seedTransactions={seedA} offline><Harness /></AppProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "begin-refresh" }));
    rerender(<AppProvider seedTransactions={seedB} offline><Harness /></AppProvider>);
    expect(ids()).toBe("b1");

    // A second, independent refresh cycle — the first one's now-consumed
    // snapshot must not linger and block this one.
    await userEvent.click(screen.getByRole("button", { name: "begin-refresh" }));
    rerender(<AppProvider seedTransactions={seedC} offline><Harness /></AppProvider>);
    expect(ids()).toBe("c1");
  });

  it("an unarmed refresh (no beginRefresh call) is never permanently blocked by an earlier mutation", async () => {
    // Mirrors a caller that doesn't opt into the race guard at all (e.g.
    // app/(app)/profile/page.tsx's router.refresh() calls, which never touch
    // transactions/budgets) — must behave like a plain, unguarded adopt.
    const seedA = [tx("a1")];
    const seedB = [tx("b1"), tx("b2")];
    const { rerender } = render(
      <AppProvider seedTransactions={seedA} offline><Harness /></AppProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "add" }));

    rerender(<AppProvider seedTransactions={seedB} offline><Harness /></AppProvider>);
    expect(ids()).toBe("b1,b2");
  });
});
