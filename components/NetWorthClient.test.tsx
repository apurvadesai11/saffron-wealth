import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Account } from "@/lib/types";
import type { NetWorthPoint } from "@/lib/net-worth-history";

// Item 9: the summary cards read local state and update optimistically, but
// `series` is a prop computed server-side. Without a refresh the chart's most
// recent point keeps contradicting the card directly above it until the user
// reloads — two different net-worth numbers on one screen. These tests pin the
// refresh so it cannot be dropped again.
const routerMocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  push: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => routerMocks,
}));

// The component reads the CSRF cookie and echoes it as a header. happy-dom
// has no cookie set, so stub the reader rather than the document.
vi.mock("@/lib/auth/csrf-client", () => ({
  readCsrfCookie: () => "test-csrf",
}));

import NetWorthClient from "./NetWorthClient";

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: "acc-1",
    name: "Chase Checking",
    type: "cash",
    institution: "Chase",
    balance: 5000,
    balanceAsOf: "2026-07-17T00:00:00.000Z",
    hiddenFromNetWorth: false,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
    ...overrides,
  };
}

const series: NetWorthPoint[] = [
  { date: "2026-06-01", value: 4000 },
  { date: "2026-07-01", value: 5000 },
];

function mockFetchOk(payload: unknown) {
  const spy = vi.fn(async () => ({
    ok: true,
    json: async () => ({ ok: true, data: payload }),
  }));
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

function mockFetchFailure(message: string) {
  const spy = vi.fn(async () => ({
    ok: false,
    json: async () => ({ ok: false, error: { message } }),
  }));
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  routerMocks.refresh.mockClear();
  routerMocks.push.mockClear();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("NetWorthClient — refresh after a balance edit", () => {
  it("refreshes the server component so the chart follows the summary card", async () => {
    const existing = account();
    mockFetchOk({ account: { ...existing, balance: 9000 } });

    render(
      <NetWorthClient
        initialAccounts={[existing]}
        initialArchivedAccounts={[]}
        series={series}
      />,
    );

    await userEvent.click(screen.getByText("Chase Checking"));
    const balanceInput = screen.getByLabelText(/balance/i);
    await userEvent.clear(balanceInput);
    await userEvent.type(balanceInput, "9000");
    await userEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(routerMocks.refresh).toHaveBeenCalledTimes(1));
  });

  it("updates local state before refreshing, so the UI responds immediately", async () => {
    const existing = account();
    mockFetchOk({ account: { ...existing, balance: 9000 } });

    render(
      <NetWorthClient
        initialAccounts={[existing]}
        initialArchivedAccounts={[]}
        series={series}
      />,
    );

    await userEvent.click(screen.getByText("Chase Checking"));
    const balanceInput = screen.getByLabelText(/balance/i);
    await userEvent.clear(balanceInput);
    await userEvent.type(balanceInput, "9000");
    await userEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    // The optimistic value is on screen even though router.refresh is a mock
    // that re-renders nothing — so local state, not the refresh, drove it.
    // The value appears in the account row, its bucket total and the summary
    // card, which is itself the evidence it propagated.
    await waitFor(() => {
      expect(screen.getAllByText("$9,000.00").length).toBeGreaterThan(0);
    });
    expect(screen.queryByText("$5,000.00")).not.toBeInTheDocument();
    expect(routerMocks.refresh).toHaveBeenCalled();
  });

  it("refreshes after adding a new account", async () => {
    mockFetchOk({
      account: account({ id: "acc-2", name: "Ally Savings", balance: 1200 }),
    });

    render(
      <NetWorthClient initialAccounts={[]} initialArchivedAccounts={[]} series={series} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /add account/i }));
    await userEvent.type(screen.getByLabelText("Account name"), "Ally Savings");
    await userEvent.type(screen.getByLabelText(/balance/i), "1200");
    await userEvent.click(screen.getByRole("button", { name: "Add Account" }));

    await waitFor(() => expect(routerMocks.refresh).toHaveBeenCalledTimes(1));
  });

  it("does not refresh when the save fails", async () => {
    // A refresh after a failed write would replace the user's unsaved input
    // with server state and look like the edit silently vanished.
    const existing = account();
    mockFetchFailure("Save failed.");

    render(
      <NetWorthClient
        initialAccounts={[existing]}
        initialArchivedAccounts={[]}
        series={series}
      />,
    );

    await userEvent.click(screen.getByText("Chase Checking"));
    await userEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(screen.getByText("Save failed.")).toBeInTheDocument());
    expect(routerMocks.refresh).not.toHaveBeenCalled();
  });
});

describe("NetWorthClient — refresh after archiving", () => {
  it("refreshes so the chart's current value drops with the totals", async () => {
    const existing = account();
    mockFetchOk({ account: existing });

    render(
      <NetWorthClient
        initialAccounts={[existing]}
        initialArchivedAccounts={[]}
        series={series}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Archive Chase Checking" }),
    );
    // Two-step now (item 14a): the row's control asks, the confirm commits.
    await userEvent.click(screen.getByRole("button", { name: /^Yes, archive/ }));

    await waitFor(() => expect(routerMocks.refresh).toHaveBeenCalledTimes(1));
  });

  it("does not refresh when the archive fails", async () => {
    const existing = account();
    mockFetchFailure("Delete failed.");

    render(
      <NetWorthClient
        initialAccounts={[existing]}
        initialArchivedAccounts={[]}
        series={series}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Archive Chase Checking" }),
    );
    // Two-step now (item 14a): the row's control asks, the confirm commits.
    await userEvent.click(screen.getByRole("button", { name: /^Yes, archive/ }));

    await waitFor(() => expect(screen.getByText("Delete failed.")).toBeInTheDocument());
    expect(routerMocks.refresh).not.toHaveBeenCalled();
  });
});

describe("NetWorthClient — refresh after restoring", () => {
  it("refreshes so the account returns to both the totals and the chart", async () => {
    const archived = account({ id: "acc-9", name: "Old Brokerage", type: "brokerage" });
    mockFetchOk({ account: archived });

    render(
      <NetWorthClient
        initialAccounts={[]}
        initialArchivedAccounts={[archived]}
        series={series}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Restore" }));

    await waitFor(() => expect(routerMocks.refresh).toHaveBeenCalledTimes(1));
  });

  it("does not refresh when the restore fails", async () => {
    const archived = account({ id: "acc-9", name: "Old Brokerage", type: "brokerage" });
    mockFetchFailure("Restore failed.");

    render(
      <NetWorthClient
        initialAccounts={[]}
        initialArchivedAccounts={[archived]}
        series={series}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Restore" }));

    await waitFor(() => expect(screen.getByText("Restore failed.")).toBeInTheDocument());
    expect(routerMocks.refresh).not.toHaveBeenCalled();
  });
});

describe("NetWorthClient — hiding an account from net worth", () => {
  const checking = account();
  const brokerage = account({ id: "acc-2", name: "Joint Brokerage", type: "brokerage", balance: 3000 });

  function netWorthCard(container: HTMLElement) {
    return within(container.querySelector("[data-net-worth-sign]") as HTMLElement);
  }

  it("PATCHes the flag, drops the balance from the totals, keeps the row listed, and refreshes", async () => {
    const spy = mockFetchOk({ account: { ...brokerage, hiddenFromNetWorth: true } });
    const { container } = render(
      <NetWorthClient initialAccounts={[checking, brokerage]} initialArchivedAccounts={[]} series={series} />,
    );
    expect(netWorthCard(container).getByText("$8,000.00")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Hide Joint Brokerage from Net Worth" }));

    await waitFor(() => expect(netWorthCard(container).getByText("$5,000.00")).toBeInTheDocument());
    expect(spy).toHaveBeenCalledWith(
      "/api/accounts/acc-2",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ hiddenFromNetWorth: true }) }),
    );
    expect(screen.getByText("Joint Brokerage")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Hidden from net worth" })).toBeInTheDocument();
    expect(routerMocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("counts a hidden account again when it's shown in net worth", async () => {
    const hidden = { ...brokerage, hiddenFromNetWorth: true };
    const spy = mockFetchOk({ account: { ...hidden, hiddenFromNetWorth: false } });
    const { container } = render(
      <NetWorthClient initialAccounts={[checking, hidden]} initialArchivedAccounts={[]} series={series} />,
    );
    expect(netWorthCard(container).getByText("$5,000.00")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Show Joint Brokerage in Net Worth" }));

    await waitFor(() => expect(netWorthCard(container).getByText("$8,000.00")).toBeInTheDocument());
    expect(spy).toHaveBeenCalledWith(
      "/api/accounts/acc-2",
      expect.objectContaining({ body: JSON.stringify({ hiddenFromNetWorth: false }) }),
    );
    expect(screen.queryByRole("img", { name: "Hidden from net worth" })).not.toBeInTheDocument();
  });

  it("leaves the account counted and does not refresh when the save fails", async () => {
    mockFetchFailure("Save failed.");
    const { container } = render(
      <NetWorthClient initialAccounts={[checking, brokerage]} initialArchivedAccounts={[]} series={series} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Hide Joint Brokerage from Net Worth" }));

    await waitFor(() => expect(screen.getByText("Save failed.")).toBeInTheDocument());
    expect(netWorthCard(container).getByText("$8,000.00")).toBeInTheDocument();
    expect(routerMocks.refresh).not.toHaveBeenCalled();
  });
});

describe("NetWorthClient — reordering accounts", () => {
  const first = account({ id: "acc-1", name: "Chase Checking" });
  const second = account({ id: "acc-2", name: "Ally Savings" });
  const dataTransfer = { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: "", dropEffect: "" };

  function names() {
    return screen.getAllByText(/^(Chase Checking|Ally Savings)$/).map((el) => el.textContent);
  }

  function dragSecondOntoFirst() {
    fireEvent.dragStart(screen.getByLabelText("Drag to reorder Ally Savings"), { dataTransfer });
    const target = screen.getByText("Chase Checking").closest("li")!;
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });
  }

  // Refreshed after the save even though order changes no total: a refresh
  // from an earlier save (an add, say) can land after the drop with the old
  // order, and only a later one puts the saved order back on screen.
  it("shows the new order at once, saves it, and then refreshes", async () => {
    const spy = mockFetchOk({ accountIds: ["acc-2", "acc-1"] });
    render(<NetWorthClient initialAccounts={[first, second]} initialArchivedAccounts={[]} series={series} />);

    dragSecondOntoFirst();

    expect(names()).toEqual(["Ally Savings", "Chase Checking"]);
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(
        "/api/accounts/order",
        expect.objectContaining({ method: "PUT", body: JSON.stringify({ accountIds: ["acc-2", "acc-1"] }) }),
      ),
    );
    await waitFor(() => expect(routerMocks.refresh).toHaveBeenCalledTimes(1));
  });

  it("puts the old order back and says so when the save fails", async () => {
    mockFetchFailure("Couldn't save the new order.");
    render(<NetWorthClient initialAccounts={[first, second]} initialArchivedAccounts={[]} series={series} />);

    dragSecondOntoFirst();

    await waitFor(() => expect(screen.getByText("Couldn't save the new order.")).toBeInTheDocument());
    expect(names()).toEqual(["Chase Checking", "Ally Savings"]);
    expect(routerMocks.refresh).not.toHaveBeenCalled();
  });
});
