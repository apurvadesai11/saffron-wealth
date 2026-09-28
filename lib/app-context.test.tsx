// AppProvider's hydration window. app/(app)/layout.tsx now seeds only the
// last 13 months of transactions instead of the whole table, so anything that
// wants an older period has to say so and wait. Without that, a consumer
// reading a pre-window month sees an empty array and reports "no
// transactions" for a month that actually has them, which is a wrong number
// rather than a slow one.
import { readFileSync } from "node:fs";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { AppProvider, useApp } from "./app-context";
import type { Transaction } from "./types";

function tx(id: string, date: string, amount = 10): Transaction {
  return {
    id,
    description: `Tx ${id}`,
    amount,
    categoryId: "cat-1",
    type: "expense",
    date,
    accountId: null,
    merchant: null,
    notes: null,
  };
}

// Exposes what the provider decided, plus a handle to drive it, so the tests
// assert on context state rather than on the mock.
let ensure: (from: string) => Promise<void>;
function Probe() {
  const { transactions, transactionsFrom, ensureTransactionsFrom } = useApp();
  ensure = ensureTransactionsFrom;
  return (
    <div>
      <span data-testid="from">{transactionsFrom ?? "unbounded"}</span>
      <span data-testid="ids">{transactions.map((t) => t.id).join(",")}</span>
    </div>
  );
}

function renderProvider(opts: { seedTransactions: Transaction[]; transactionsFrom?: string }) {
  return render(
    <AppProvider
      seedCategories={[]}
      seedBudgets={[]}
      seedTransactions={opts.seedTransactions}
      transactionsFrom={opts.transactionsFrom}
    >
      <Probe />
    </AppProvider>,
  );
}

function page(transactions: Transaction[], nextCursor: string | null = null) {
  return {
    ok: true,
    json: async () => ({ ok: true, data: { transactions, nextCursor, total: transactions.length } }),
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AppProvider hydration window", () => {
  it("exposes the window start the layout seeded it with", () => {
    renderProvider({ seedTransactions: [tx("a", "2026-09-01")], transactionsFrom: "2025-09-01" });

    expect(screen.getByTestId("from")).toHaveTextContent("2025-09-01");
  });

  it("reports an unbounded window when the layout seeded no start", () => {
    renderProvider({ seedTransactions: [tx("a", "2026-09-01")] });

    expect(screen.getByTestId("from")).toHaveTextContent("unbounded");
  });

  it("does not fetch for a date already inside the window", async () => {
    renderProvider({ seedTransactions: [tx("a", "2026-09-01")], transactionsFrom: "2025-09-01" });

    await act(async () => {
      await ensure("2026-01-01");
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not fetch when the window is unbounded", async () => {
    renderProvider({ seedTransactions: [tx("a", "2026-09-01")] });

    await act(async () => {
      await ensure("2019-01-01");
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches only the gap below the current window start", async () => {
    fetchMock.mockResolvedValue(page([tx("old", "2024-06-15")]));
    renderProvider({ seedTransactions: [tx("a", "2026-09-01")], transactionsFrom: "2025-09-01" });

    await act(async () => {
      await ensure("2024-01-01");
    });

    const url = new URL(fetchMock.mock.calls[0][0], "http://localhost");
    expect(url.searchParams.get("from")).toBe("2024-01-01");
    // The day before the existing window start: re-requesting rows the
    // provider already holds wastes a payload on every navigation back.
    expect(url.searchParams.get("to")).toBe("2025-08-31");
  });

  it("merges fetched rows into the transaction list", async () => {
    fetchMock.mockResolvedValue(page([tx("old", "2024-06-15")]));
    renderProvider({ seedTransactions: [tx("a", "2026-09-01")], transactionsFrom: "2025-09-01" });

    await act(async () => {
      await ensure("2024-01-01");
    });

    await waitFor(() => {
      expect(screen.getByTestId("ids")).toHaveTextContent("a,old");
    });
  });

  it("widens the window start after a successful fetch", async () => {
    fetchMock.mockResolvedValue(page([tx("old", "2024-06-15")]));
    renderProvider({ seedTransactions: [tx("a", "2026-09-01")], transactionsFrom: "2025-09-01" });

    await act(async () => {
      await ensure("2024-01-01");
    });

    await waitFor(() => {
      expect(screen.getByTestId("from")).toHaveTextContent("2024-01-01");
    });
  });

  it("follows nextCursor until the gap is fully loaded", async () => {
    fetchMock
      .mockResolvedValueOnce(page([tx("p1", "2024-06-15")], "cursor-1"))
      .mockResolvedValueOnce(page([tx("p2", "2024-03-15")], null));
    renderProvider({ seedTransactions: [tx("a", "2026-09-01")], transactionsFrom: "2025-09-01" });

    await act(async () => {
      await ensure("2024-01-01");
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = new URL(fetchMock.mock.calls[1][0], "http://localhost");
    expect(second.searchParams.get("cursor")).toBe("cursor-1");
    await waitFor(() => {
      expect(screen.getByTestId("ids")).toHaveTextContent("a,p1,p2");
    });
  });

  it("drops a row it already holds rather than duplicating it", async () => {
    fetchMock.mockResolvedValue(page([tx("a", "2026-09-01"), tx("old", "2024-06-15")]));
    renderProvider({ seedTransactions: [tx("a", "2026-09-01")], transactionsFrom: "2025-09-01" });

    await act(async () => {
      await ensure("2024-01-01");
    });

    await waitFor(() => {
      expect(screen.getByTestId("ids")).toHaveTextContent("a,old");
    });
  });

  // The window start is the provider's claim about what it holds. Widening it
  // on a failed fetch would make every later consumer believe data is present
  // that never arrived, and the empty result reads as "no transactions".
  it("leaves the window start alone when the fetch fails", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    renderProvider({ seedTransactions: [tx("a", "2026-09-01")], transactionsFrom: "2025-09-01" });

    await act(async () => {
      await ensure("2024-01-01");
    });

    expect(screen.getByTestId("from")).toHaveTextContent("2025-09-01");
  });

  it("leaves the window start alone on a non-ok response", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ ok: false }) });
    renderProvider({ seedTransactions: [tx("a", "2026-09-01")], transactionsFrom: "2025-09-01" });

    await act(async () => {
      await ensure("2024-01-01");
    });

    expect(screen.getByTestId("from")).toHaveTextContent("2025-09-01");
  });
});

// The README states as fact that "production never falls back to [mock data]:
// the (app) layout always passes real (possibly empty) arrays". That was an
// assertion about a code path, not a guarantee: the seed props were optional
// and defaulted to MOCK_*. In a wealth tracker, a regression that drops a
// seed prop renders fabricated balances indistinguishable from real ones, and
// the user has no way to tell. The props are now required, so the type system
// is what enforces the claim.
//
// Asserted against the source text because that is the actual invariant --
// there is no runtime path left to exercise, which is the point. A future
// edit that reintroduces a fallback fails here.
describe("AppProvider cannot reach mock data", () => {
  // Vitest runs from the repo root; import.meta.url is not a file: URL
  // under happy-dom, so resolve from cwd instead.
  const source = readFileSync("lib/app-context.tsx", "utf8");

  it("does not reference MOCK_ anywhere", () => {
    const hits = source
      .split("\n")
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => line.includes("MOCK_"));

    expect(hits).toEqual([]);
  });

  it("does not import from mock-data", () => {
    expect(source).not.toMatch(/from\s+"\.\/mock-data"/);
  });
});
