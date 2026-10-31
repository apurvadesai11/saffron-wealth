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
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    hiddenFromNetWorth: false,
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

function renderGroup(g: Group, onReorder = vi.fn()) {
  return render(
    <AccountBucketGroup
      group={g}
      onEdit={vi.fn()}
      onArchive={vi.fn()}
      onToggleHidden={vi.fn()}
      onReorder={onReorder}
    />,
  );
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
    expect(headerTotal(container)).toBe("$1,000.00");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("starts expanded and collapses its accounts from the heading, keeping the total in view", async () => {
    const { container } = renderGroup(
      group({ accounts: [account(), account({ id: "acc-2", name: "Other" })] }),
    );
    const toggle = screen.getByRole("button", { name: "Cash" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    await userEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(container.querySelector('[data-collapsed="true"]')).toBeInTheDocument();
    expect(headerTotal(container)).toBe("$1,000.00");

    await userEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("hides the uncategorized explanation along with its accounts when collapsed", async () => {
    renderGroup(
      group({
        bucket: "uncategorized",
        label: "Uncategorized",
        accounts: [account({ type: "uncategorized" })],
      }),
    );

    await userEvent.click(screen.getByRole("button", { name: "Uncategorized" }));

    expect(screen.queryByText(/Excluded from your net worth/i)).not.toBeInTheDocument();
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

describe("AccountBucketGroup — drag-and-drop reordering", () => {
  const three = group({
    accounts: [
      account({ id: "a", name: "Alpha" }),
      account({ id: "b", name: "Bravo" }),
      account({ id: "c", name: "Charlie" }),
    ],
  });

  // happy-dom's DragEvent has no DataTransfer; the component only writes to it.
  const dataTransfer = { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: "", dropEffect: "" };

  function rowOf(name: string) {
    return screen.getByText(name).closest("li")!;
  }

  function drag(from: string, onto: string) {
    fireEvent.dragStart(screen.getByLabelText(`Drag to reorder ${from}`), { dataTransfer });
    fireEvent.dragOver(rowOf(onto), { dataTransfer });
    fireEvent.drop(rowOf(onto), { dataTransfer });
  }

  it("reports the section's new order when a row is dropped on another", () => {
    const onReorder = vi.fn();
    renderGroup(three, onReorder);

    drag("Charlie", "Alpha");

    expect(onReorder).toHaveBeenCalledWith(["c", "a", "b"]);
  });

  it("does nothing when a row is dropped on itself", () => {
    const onReorder = vi.fn();
    renderGroup(three, onReorder);

    drag("Bravo", "Bravo");

    expect(onReorder).not.toHaveBeenCalled();
  });

  // Each section tracks only its own drag, so a row dragged from another
  // section (which would mean changing its type) isn't accepted here.
  it("ignores a drop that didn't start in this section", () => {
    const onReorder = vi.fn();
    renderGroup(three, onReorder);

    fireEvent.dragOver(rowOf("Alpha"), { dataTransfer });
    fireEvent.drop(rowOf("Alpha"), { dataTransfer });

    expect(onReorder).not.toHaveBeenCalled();
  });

  it("marks the row being dragged over so it can be highlighted", () => {
    renderGroup(three);

    fireEvent.dragStart(screen.getByLabelText("Drag to reorder Charlie"), { dataTransfer });
    fireEvent.dragOver(rowOf("Alpha"), { dataTransfer });

    expect(rowOf("Alpha")).toHaveAttribute("data-drag-state", "over");
    expect(rowOf("Charlie")).toHaveAttribute("data-drag-state", "dragging");

    fireEvent.dragEnd(screen.getByLabelText("Drag to reorder Charlie"), { dataTransfer });

    expect(rowOf("Alpha")).not.toHaveAttribute("data-drag-state");
  });

  it("offers no drag handle when the section has only one account", () => {
    renderGroup(group());

    expect(screen.queryByLabelText(/Drag to reorder/)).not.toBeInTheDocument();
  });
});
