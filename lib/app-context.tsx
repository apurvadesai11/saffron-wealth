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
  // write has no per-row response to merge locally, and app/(app)/profile/
  // page.tsx already calls it after every profile save and picture upload)
  // would otherwise be silently ignored here — unlike `categories` above,
  // which is a plain binding and picks up new props for free. Guarded on the
  // seed reference itself, not a fixed interval, so it only fires when the
  // server layout actually re-ran — normal client-side navigation between
  // (app) routes reuses the same layout instance and never touches this.
  //
  // A naive "just adopt the new seed" version of this has a real race:
  // router.refresh() snapshots the DB at some point during its round trip.
  // If a *newer* local mutation (e.g. deleting a transaction) completes
  // after that snapshot was taken but before the refreshed props land,
  // blindly adopting the seed resurrects whatever the newer mutation just
  // removed. `*MutationVersionRef` is bumped by every local mutation
  // (add/delete/save, online or offline); `*SyncedVersionRef` records the
  // mutation version as of the last seed we accepted or skipped. If they
  // still match when a new seed arrives, nothing local has raced ahead of
  // it and it's safe to adopt; if they don't, the seed is treated as
  // possibly stale and skipped — the more-recent local truth wins, and the
  // seed's own new information (e.g. freshly imported rows) simply waits
  // for the next clean refresh instead. That's a narrow trade-off, but far
  // safer than ever re-materializing something the user just deleted.
  //
  // Adjusting state directly during render (React's documented pattern for
  // deriving state from a changed prop) rather than in a useEffect applies
  // the new value before the first paint, instead of painting the old state
  // and correcting it a frame later.
  const [prevSeedTransactions, setPrevSeedTransactions] = useState(seedTransactions);
  const [prevSeedBudgets, setPrevSeedBudgets] = useState(seedBudgets);
  const txMutationVersionRef = useRef(0);
  const txSyncedVersionRef = useRef(0);
  const budgetMutationVersionRef = useRef(0);
  const budgetSyncedVersionRef = useRef(0);

  if (seedTransactions !== prevSeedTransactions) {
    setPrevSeedTransactions(seedTransactions);
    if (seedTransactions && txMutationVersionRef.current === txSyncedVersionRef.current) {
      setTransactions(seedTransactions);
    }
    txSyncedVersionRef.current = txMutationVersionRef.current;
  }
  if (seedBudgets !== prevSeedBudgets) {
    setPrevSeedBudgets(seedBudgets);
    if (seedBudgets && budgetMutationVersionRef.current === budgetSyncedVersionRef.current) {
      setBudgets(seedBudgets);
    }
    budgetSyncedVersionRef.current = budgetMutationVersionRef.current;
  }

  async function addTransaction(t: Omit<Transaction, "id">) {
    if (offline) {
      setTransactions(prev => [{ ...t, id: `local-${++localId}` }, ...prev]);
      txMutationVersionRef.current++;
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
    txMutationVersionRef.current++;
  }

  async function deleteTransaction(id: string) {
    if (offline) {
      setTransactions(prev => prev.filter(t => t.id !== id));
      txMutationVersionRef.current++;
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
    txMutationVersionRef.current++;
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
      budgetMutationVersionRef.current++;
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
    budgetMutationVersionRef.current++;
  }

  return (
    <AppContext.Provider value={{
      categories,
      transactions,
      budgets,
      saveBudgets,
      addTransaction,
      deleteTransaction,
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
