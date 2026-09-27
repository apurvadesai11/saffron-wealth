// The Transactions page used to filter a fully-hydrated array in the browser.
// AppProvider now seeds only the last 13 months, so the page reads GET
// /api/transactions instead: the server filters, counts, and pages.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TransactionsPage from "./page";
import { renderWithApp, CAT_GROCERIES, CAT_RENT } from "@/components/__tests__/test-utils";
import type { Transaction } from "@/lib/types";

const CATS = [CAT_GROCERIES, CAT_RENT];

function tx(id: string, description: string, date = "2026-09-01"): Transaction {
  return {
    id,
    description,
    amount: 25,
    categoryId: CAT_GROCERIES.id,
    type: "expense",
    date,
    accountId: null,
    merchant: null,
    notes: null,
  };
}

function page(transactions: Transaction[], nextCursor: string | null = null, total?: number) {
  return {
    ok: true,
    json: async () => ({
      ok: true,
      data: { transactions, nextCursor, total: total ?? transactions.length },
    }),
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(page([]));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function lastQuery(): URLSearchParams {
  const calls = fetchMock.mock.calls;
  return new URL(calls[calls.length - 1][0], "http://localhost").searchParams;
}

describe("TransactionsPage server-side paging", () => {
  it("renders the rows the server returned", async () => {
    fetchMock.mockResolvedValue(page([tx("1", "Coffee Roasters"), tx("2", "Hardware Store")]));

    renderWithApp(<TransactionsPage />, { categories: CATS, transactions: [] });

    expect(await screen.findByText("Coffee Roasters")).toBeInTheDocument();
    expect(screen.getByText("Hardware Store")).toBeInTheDocument();
  });

  // The seed is a bounded window, so counting it would under-report the total
  // as soon as a user has more history than the window holds.
  it("reports the server's total rather than counting the hydrated seed", async () => {
    fetchMock.mockResolvedValue(page([tx("1", "Coffee Roasters")], null, 7576));

    renderWithApp(<TransactionsPage />, {
      categories: CATS,
      transactions: [tx("seeded", "Seeded row")],
    });

    expect(await screen.findByText(/of 7576 transactions/i)).toBeInTheDocument();
  });

  it("sends the active filter to the server instead of filtering locally", async () => {
    renderWithApp(<TransactionsPage />, { categories: CATS, transactions: [] });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText(/type/i), "income");

    await waitFor(() => expect(lastQuery().get("type")).toBe("income"));
  });

  it("appends the next page when Load more is clicked", async () => {
    fetchMock
      .mockResolvedValueOnce(page([tx("1", "First page row")], "cursor-1", 2))
      .mockResolvedValueOnce(page([tx("2", "Second page row")], null, 2));

    renderWithApp(<TransactionsPage />, { categories: CATS, transactions: [] });
    expect(await screen.findByText("First page row")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /load more/i }));

    expect(await screen.findByText("Second page row")).toBeInTheDocument();
    // Appended, not replaced — a "load more" that drops the previous page is
    // just a slower way to paginate.
    expect(screen.getByText("First page row")).toBeInTheDocument();
    expect(lastQuery().get("cursor")).toBe("cursor-1");
  });

  it("offers no Load more on the last page", async () => {
    fetchMock.mockResolvedValue(page([tx("1", "Only row")], null, 1));

    renderWithApp(<TransactionsPage />, { categories: CATS, transactions: [] });
    expect(await screen.findByText("Only row")).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
  });

  it("drops a stale page when the filter changes mid-load", async () => {
    fetchMock
      .mockResolvedValueOnce(page([tx("1", "Unfiltered row")], "cursor-1", 2))
      .mockResolvedValueOnce(page([tx("2", "Filtered row")], null, 1));

    renderWithApp(<TransactionsPage />, { categories: CATS, transactions: [] });
    expect(await screen.findByText("Unfiltered row")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText(/type/i), "income");

    expect(await screen.findByText("Filtered row")).toBeInTheDocument();
    expect(screen.queryByText("Unfiltered row")).not.toBeInTheDocument();
  });

  it("surfaces a failed load instead of showing an empty list", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));

    renderWithApp(<TransactionsPage />, { categories: CATS, transactions: [] });

    expect(await screen.findByText(/couldn't load transactions/i)).toBeInTheDocument();
  });
});
