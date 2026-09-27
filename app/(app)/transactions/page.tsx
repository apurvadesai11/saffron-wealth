"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/lib/app-context";
import TransactionForm from "@/components/TransactionForm";
import TransactionList from "@/components/TransactionList";
import TransactionFilters, {
  EMPTY_FILTERS,
  TransactionFilterState,
} from "@/components/TransactionFilters";
import MonarchImportModal from "@/components/MonarchImportModal";
import type { Transaction } from "@/lib/types";

const PAGE_SIZE = 100;
// Keystrokes in the search box shouldn't each cost a round trip. Short enough
// that the list still feels live while typing.
const FILTER_DEBOUNCE_MS = 250;

// Filter state to query string. Empty values are omitted rather than sent as
// blanks, so the URL reflects only what's actually filtering, and `type:
// "all"` is the UI's own no-filter sentinel that the parser also understands.
function toQuery(filters: TransactionFilterState, cursor: string | null): string {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (filters.search.trim()) params.set("search", filters.search.trim());
  if (filters.type !== "all") params.set("type", filters.type);
  if (filters.categoryIds.length) params.set("categoryIds", filters.categoryIds.join(","));
  if (filters.dateFrom) params.set("from", filters.dateFrom);
  if (filters.dateTo) params.set("to", filters.dateTo);
  if (filters.amountMin) params.set("amountMin", filters.amountMin);
  if (filters.amountMax) params.set("amountMax", filters.amountMax);
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}

export default function TransactionsPage() {
  // `transactions` is read only as a change signal: AppProvider holds a
  // bounded window, so it can't answer this page's queries, but its identity
  // changes on every local add/delete and that's exactly when the current
  // page needs re-fetching.
  const { transactions: mutationSignal } = useApp();
  const [showForm, setShowForm] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [filters, setFilters] = useState<TransactionFilterState>(EMPTY_FILTERS);

  const [rows, setRows] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Monotonic id for the newest request. A response whose id is stale gets
  // dropped: without this, a slow unfiltered page can land after a fast
  // filtered one and repopulate the list with rows the filter excludes.
  const requestIdRef = useRef(0);

  const load = useCallback(
    async (cursor: string | null) => {
      const requestId = ++requestIdRef.current;
      setLoading(true);
      if (cursor === null) setError(null);
      try {
        const res = await fetch(`/api/transactions?${toQuery(filters, cursor)}`);
        const body = await res.json();
        if (!res.ok || !body.ok) {
          throw new Error(body?.error?.message ?? "Failed to load transactions.");
        }
        if (requestId !== requestIdRef.current) return;
        const fetched = body.data.transactions as Transaction[];
        // A cursor means "extend"; no cursor means this is a fresh filter and
        // whatever is on screen belongs to the previous one.
        setRows(prev => (cursor === null ? fetched : prev.concat(fetched)));
        setTotal(body.data.total as number);
        setNextCursor((body.data.nextCursor as string | null) ?? null);
        setError(null);
      } catch {
        if (requestId !== requestIdRef.current) return;
        setError("We couldn't load transactions. Check your connection and try again.");
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    },
    [filters],
  );

  // Debounced so typing in the search box doesn't fire a request per
  // keystroke. `mutationSignal` is in the deps on purpose (see above).
  useEffect(() => {
    const timer = setTimeout(() => void load(null), FILTER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [load, mutationSignal]);

  return (
    <>
      <TransactionFilters
        value={filters}
        onChange={setFilters}
        onReset={() => setFilters(EMPTY_FILTERS)}
      />

      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="flex items-center justify-between px-6 pt-6 pb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">Transactions</h2>
            <p className="text-xs text-gray-400 mt-0.5" aria-live="polite">
              {loading && rows.length === 0
                ? "Loading…"
                : `${rows.length} of ${total} ${total === 1 ? "transaction" : "transactions"}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowImportModal(true)}
              className="border border-gray-200 text-gray-700 rounded-lg py-1.5 px-4 text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              Import from Monarch
            </button>
            <button
              onClick={() => setShowForm(prev => !prev)}
              className="bg-blue-600 text-white rounded-lg py-1.5 px-4 text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              {showForm ? "Cancel" : "+ Add Transaction"}
            </button>
          </div>
        </div>

        {showForm && (
          <div className="px-6 pb-6 border-b border-gray-100">
            <TransactionForm onSubmitted={() => setShowForm(false)} />
          </div>
        )}

        {error ? (
          <div className="px-6 py-8 text-center" role="alert">
            <p className="text-sm text-gray-500">{error}</p>
            <button
              onClick={() => void load(null)}
              className="mt-3 text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              Try again
            </button>
          </div>
        ) : (
          <>
            <TransactionList transactions={rows} />

            {nextCursor && (
              <div className="px-6 py-4 border-t border-gray-100 text-center">
                <button
                  onClick={() => void load(nextCursor)}
                  disabled={loading}
                  className="text-sm font-medium text-blue-600 hover:text-blue-700 disabled:text-gray-400"
                >
                  {loading ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {showImportModal && (
        <MonarchImportModal onClose={() => setShowImportModal(false)} />
      )}
    </>
  );
}
