// The Uncategorized bucket rendered with the same heading, the same
// right-aligned total and the same typography as Cash, Investments and Debt —
// while contributing to none of the summary cards above it. A reasonable
// person reads the bucket list as the decomposition of those cards, so the
// page showed a list that does not add up and said nothing about why.
//
// Contrast ArchivedAccountsGroup, the other excluded-from-net-worth group: a
// collapsed <details> in muted grey, which reads as "set aside". Uncategorized
// read as "counted".
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AccountBucketGroup from "./AccountBucketGroup";
import type { Account, AccountBucketGroup as Group } from "@/lib/types";

function account(over: Partial<Account> = {}): Account {
  return {
    id: "acc-1",
    name: "Some Account",
    type: "cash",
    institution: null,
    balance: 1000,
    balanceAsOf: "2026-02-14T00:00:00.000Z",
    createdAt: "2026-02-14T00:00:00.000Z",
    updatedAt: "2026-02-14T00:00:00.000Z",
    ...over,
  };
}

function group(over: Partial<Group> = {}): Group {
  return {
    bucket: "cash",
    label: "Cash",
    accounts: [account()],
    bucketTotal: 1000,
    ...over,
  };
}

function renderGroup(g: Group) {
  return render(<AccountBucketGroup group={g} onEdit={vi.fn()} onArchive={vi.fn()} />);
}

// The bucket total and a single account's balance can render the same string,
// so the total is read from the header rather than by text alone.
function headerTotal(container: HTMLElement): string | null {
  return container.querySelector("section > div > span")?.textContent ?? null;
}

describe("AccountBucketGroup", () => {
  it("shows the bucket label, its total, and a row per account", () => {
    const { container } = renderGroup(
      group({ accounts: [account(), account({ id: "acc-2", name: "Other" })] }),
    );

    expect(screen.getByText("Cash")).toBeInTheDocument();
    expect(headerTotal(container)).toBe("$1000.00");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("tags itself with its bucket so the page can style and target it", () => {
    const { container } = renderGroup(group());
    expect(container.querySelector('[data-bucket="cash"]')).toBeInTheDocument();
  });

  it("says nothing extra for a bucket that does count toward net worth", () => {
    renderGroup(group());
    expect(screen.queryByText(/Excluded from your net worth/i)).not.toBeInTheDocument();
  });
});

describe("AccountBucketGroup — the uncategorized bucket", () => {
  const uncategorized = group({
    bucket: "uncategorized",
    label: "Uncategorized",
    accounts: [account({ type: "uncategorized", name: "Travel Card, Signature", balance: 250 })],
    bucketTotal: 250,
  });

  it("says on the page that it is excluded from net worth", () => {
    renderGroup(uncategorized);

    expect(screen.getByText(/Excluded from your net worth/i)).toBeInTheDocument();
  });

  it("tells the user what to do about it", () => {
    renderGroup(uncategorized);

    expect(screen.getByText(/set a type/i)).toBeInTheDocument();
  });

  // Styling is the signal here, so there is a stable attribute to assert on
  // instead of a class string — the convention CLAUDE.md sets out.
  it("marks itself as excluded for styling and for tests", () => {
    const { container } = renderGroup(uncategorized);

    expect(container.querySelector('[data-excluded-from-net-worth="true"]')).toBeInTheDocument();
  });

  it("does not mark a counted bucket as excluded", () => {
    const { container } = renderGroup(group());

    expect(container.querySelector("[data-excluded-from-net-worth]")).toBeNull();
  });

  // Still shows the total: the number is real, it just isn't in the cards.
  // Hiding it would leave the user unable to see what they are being asked to
  // classify.
  it("still shows the bucket's own total", () => {
    const { container } = renderGroup(uncategorized);

    expect(headerTotal(container)).toBe("$250.00");
  });
});
