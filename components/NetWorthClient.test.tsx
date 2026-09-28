import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
      expect(screen.getAllByText("$9000.00").length).toBeGreaterThan(0);
    });
    expect(screen.queryByText("$5000.00")).not.toBeInTheDocument();
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
      screen.getByRole("button", { name: "Delete Chase Checking" }),
    );

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
      screen.getByRole("button", { name: "Delete Chase Checking" }),
    );

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
