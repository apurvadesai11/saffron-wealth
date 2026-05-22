"use client";

import {
  createContext,
  useContext,
  useState,
  Dispatch,
  SetStateAction,
  ReactNode,
} from "react";
import { Category, Transaction, Budget } from "./types";
import { MOCK_CATEGORIES, MOCK_TRANSACTIONS, MOCK_BUDGETS } from "./mock-data";

interface AppContextValue {
  categories: Category[];
  transactions: Transaction[];
  budgets: Budget[];
  setBudgets: Dispatch<SetStateAction<Budget[]>>;
  addTransaction: (t: Omit<Transaction, "id">) => void;
  deleteTransaction: (id: number) => void;
  // Lifted so the sidebar AlertsButton and the MonthlyReviewWidget share state
  dismissedKeys: Set<string>;
  setDismissedKeys: Dispatch<SetStateAction<Set<string>>>;
}

const AppContext = createContext<AppContextValue | null>(null);

let nextId = 1000; // start above mock IDs to avoid collisions

interface AppProviderProps {
  children: ReactNode;
  // Optional seed overrides for tests. Production callers omit these and get
  // the MOCK_* defaults; component tests can inject deterministic fixtures
  // without poking at module-scoped mock data.
  seedCategories?: Category[];
  seedTransactions?: Transaction[];
  seedBudgets?: Budget[];
}

export function AppProvider({
  children,
  seedCategories,
  seedTransactions,
  seedBudgets,
}: AppProviderProps) {
  const [transactions, setTransactions] = useState<Transaction[]>(
    seedTransactions ?? MOCK_TRANSACTIONS,
  );
  const [budgets, setBudgets] = useState<Budget[]>(seedBudgets ?? MOCK_BUDGETS);
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(new Set());
  const categories = seedCategories ?? MOCK_CATEGORIES;

  function addTransaction(t: Omit<Transaction, "id">) {
    setTransactions(prev => [{ ...t, id: ++nextId }, ...prev]);
  }

  function deleteTransaction(id: number) {
    setTransactions(prev => prev.filter(t => t.id !== id));
  }

  return (
    <AppContext.Provider value={{
      categories,
      transactions,
      budgets,
      setBudgets,
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
