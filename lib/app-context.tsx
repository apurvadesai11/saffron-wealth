"use client";

import {
  createContext,
  useContext,
  useRef,
  useState,
  Dispatch,
  SetStateAction,
  ReactNode,
} from "react";
import { Category, Transaction, Budget } from "./types";
import { MOCK_CATEGORIES, MOCK_TRANSACTIONS, MOCK_BUDGETS } from "./mock-data";
import { readCsrfCookie } from "./auth/csrf-client";
import { CSRF_HEADER_NAME } from "./auth/csrf-shared";

interface AppContextValue {
  categories: Category[];
  transactions: Transaction[];
  budgets: Budget[];
  // Always a batch (one entry for a manual edit, many for "Auto-Set All") so
  // there's a single upsert call and a single source of truth for the
  // resulting list — mirrors PUT /api/budgets.
  saveBudgets: (entries: Budget[]) => Promise<void>;
  addTransaction: (t: Omit<Transaction, "id">) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;
  // Call immediately before router.refresh() whenever a caller needs the
  // eventual fresh seed adopted even if a local mutation happened earlier in
  // the session (see the long comment above the seed-sync block below for
  // why this exists — the provider can't infer "refresh requested now" on
  // its own). Optional for any caller that doesn't need that guarantee;
  // skipping it just means that caller's refresh behaves like a plain,
  // unguarded adopt (today's profile-page saves, which don't touch
  // transactions/budgets at all, don't need to call this).
  beginRefresh: () => void;
  // Lifted so the sidebar AlertsButton and the MonthlyReviewWidget share state
  dismissedKeys: Set<string>;
  setDismissedKeys: Dispatch<SetStateAction<Set<string>>>;
}

const AppContext = createContext<AppContextValue | null>(null);

let localId = 0; // offline-mode id counter (tests only — see AppProviderProps.offline)

interface AppProviderProps {
  children: ReactNode;
  // Real data from Postgres, fetched server-side by app/(app)/layout.tsx and
  // passed down. Also doubles as test-fixture injection: component tests call
  // renderWithApp() with these instead of touching module-scoped mock data.
  // Omitted only when neither applies, which falls back to MOCK_* — that
  // path is a safety net for stray test callers, never exercised in
  // production (the (app) layout always passes real, possibly empty, arrays).
  seedCategories?: Category[];
  seedTransactions?: Transaction[];
  seedBudgets?: Budget[];
  // Test-only: mutate local state directly instead of calling the API, so
  // component tests can assert on the result synchronously without mocking
  // fetch. Always true via renderWithApp; production never sets this.
  offline?: boolean;
}

export function AppProvider({
  children,
  seedCategories,
  seedTransactions,
  seedBudgets,
  offline = false,
}: AppProviderProps) {
  const [transactions, setTransactions] = useState<Transaction[]>(
    seedTransactions ?? MOCK_TRANSACTIONS,
  );
  const [budgets, setBudgets] = useState<Budget[]>(seedBudgets ?? MOCK_BUDGETS);
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(new Set());
  const categories = seedCategories ?? MOCK_CATEGORIES;

  // useState's initializer only runs on mount, so a later re-render carrying
  // a fresh seed prop (e.g. app/(app)/layout.tsx re-fetching after
  // router.refresh() — the Monarch import's commit calls it because a bulk
  // write has no per-row response to merge locally) would otherwise be
  // silently ignored here — unlike `categories` above, which is a plain
  // binding and picks up new props for free. Guarded on the seed reference
  // itself, not a fixed interval, so it only fires when the server layout
  // actually re-ran — normal client-side navigation between (app) routes
  // reuses the same layout instance and, as far as this file's callers go
  // today, shouldn't touch this; app/(app)/profile/page.tsx's two
  // router.refresh() calls are the one other trigger, and both immediately
  // navigate to /login, unmounting this provider before it matters.
  //
  // A naive "just adopt the new seed" version of this has a real race:
  // router.refresh() snapshots the DB at some point during its round trip.
  // If a *newer* local mutation (e.g. deleting a transaction) completes
  // after that snapshot was taken but before the refreshed props land,
  // blindly adopting the seed resurrects whatever the newer mutation just
  // removed. The fix needs to know the mutation count as of the moment the
  // refresh was *requested* — not as of the last seed change, which was the
  // bug in an earlier version of this guard: a mutation from minutes
  // earlier in the session (this provider lives at the (app) layout level
  // and survives navigation) would permanently look like a "race" against
  // every later refresh, even ones that postdate it by a mile, silently
  // dropping their data forever.
  //
  // `mutationVersionRef` is bumped by every local mutation (add/delete tx,
  // save budgets; online or offline). `beginRefresh()` — called by a
  // consumer immediately before it calls router.refresh() — snapshots that
  // counter into `pendingRefreshBaseline` state. When a new seed arrives:
  //   - no snapshot pending (`null`, the default) → adopt unconditionally.
  //     A caller that never calls beginRefresh() gets exactly the old
  //     unguarded behavior, so profile-page-style refreshes (which never
  //     touch financial data) can't be permanently locked out of adoption
  //     by an unrelated mutation just because they didn't opt in.
  //   - snapshot pending and unchanged → nothing raced the requested
  //     refresh; adopt.
  //   - snapshot pending and changed → something mutated after the refresh
  //     was requested; skip. The seed's own new information (e.g. freshly
  //     imported rows) waits for the next clean refresh instead — a narrow
  //     trade-off, but far safer than resurrecting something just deleted.
  // The snapshot is consumed (reset to null) the moment a seed change is
  // evaluated, whether adopted or skipped, so it can never latch and block
  // some later, unrelated refresh.
  //
  // Both the "consumed" reset and the previous-seed trackers live in
  // useState, not a plain ref: a ref write made during render is not rolled
  // back if that render attempt is discarded (an interrupted transition —
  // router.refresh() runs at transition priority — or a Suspense/error
  // retry), so a discarded attempt could permanently consume the snapshot
  // before the "real" committed attempt ever sees it. State updates queued
  // during render don't have that problem — this is also, incidentally,
  // React's documented pattern for deriving state from a changed prop,
  // applying the new value before the first paint instead of painting the
  // old state and correcting it a frame later.
  const [prevSeedTransactions, setPrevSeedTransactions] = useState(seedTransactions);
  const [prevSeedBudgets, setPrevSeedBudgets] = useState(seedBudgets);
  const [pendingRefreshBaseline, setPendingRefreshBaseline] = useState<number | null>(null);
  const mutationVersionRef = useRef(0);

  function beginRefresh() {
    setPendingRefreshBaseline(mutationVersionRef.current);
  }

  const seedTransactionsChanged = seedTransactions !== prevSeedTransactions;
  const seedBudgetsChanged = seedBudgets !== prevSeedBudgets;
  if (seedTransactionsChanged) setPrevSeedTransactions(seedTransactions);
  if (seedBudgetsChanged) setPrevSeedBudgets(seedBudgets);

  if (seedTransactionsChanged || seedBudgetsChanged) {
    const safeToAdopt =
      pendingRefreshBaseline === null || mutationVersionRef.current === pendingRefreshBaseline;
    if (safeToAdopt) {
      if (seedTransactionsChanged && seedTransactions) setTransactions(seedTransactions);
      if (seedBudgetsChanged && seedBudgets) setBudgets(seedBudgets);
    }
    if (pendingRefreshBaseline !== null) setPendingRefreshBaseline(null);
  }

  async function addTransaction(t: Omit<Transaction, "id">) {
    if (offline) {
      setTransactions(prev => [{ ...t, id: `local-${++localId}` }, ...prev]);
      mutationVersionRef.current++;
      return;
    }
    const csrf = readCsrfCookie() ?? "";
    const res = await fetch("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json", [CSRF_HEADER_NAME]: csrf },
      body: JSON.stringify(t),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data?.error?.message ?? "Failed to add transaction.");
    }
    setTransactions(prev => [data.data.transaction as Transaction, ...prev]);
    mutationVersionRef.current++;
  }

  async function deleteTransaction(id: string) {
    if (offline) {
      setTransactions(prev => prev.filter(t => t.id !== id));
      mutationVersionRef.current++;
      return;
    }
    const csrf = readCsrfCookie() ?? "";
    const res = await fetch(`/api/transactions/${id}`, {
      method: "DELETE",
      headers: { [CSRF_HEADER_NAME]: csrf },
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data?.error?.message ?? "Failed to delete transaction.");
    }
    setTransactions(prev => prev.filter(t => t.id !== id));
    mutationVersionRef.current++;
  }

  async function saveBudgets(entries: Budget[]) {
    if (offline) {
      setBudgets(prev => {
        const next = [...prev];
        for (const entry of entries) {
          const idx = next.findIndex(
            b => b.categoryId === entry.categoryId && b.period === entry.period,
          );
          if (idx >= 0) next[idx] = entry;
          else next.push(entry);
        }
        return next;
      });
      mutationVersionRef.current++;
      return;
    }
    const csrf = readCsrfCookie() ?? "";
    const res = await fetch("/api/budgets", {
      method: "PUT",
      headers: { "Content-Type": "application/json", [CSRF_HEADER_NAME]: csrf },
      body: JSON.stringify({ entries }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data?.error?.message ?? "Failed to save budgets.");
    }
    setBudgets(data.data.budgets as Budget[]);
    mutationVersionRef.current++;
  }

  return (
    <AppContext.Provider value={{
      categories,
      transactions,
      budgets,
      saveBudgets,
      addTransaction,
      deleteTransaction,
      beginRefresh,
      dismissedKeys,
      setDismissedKeys,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
