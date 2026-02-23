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
}

const AppContext = createContext<AppContextValue | null>(null);

let nextId = 1000; // start above mock IDs to avoid collisions

export function AppProvider({ children }: { children: ReactNode }) {
  const [transactions, setTransactions] = useState<Transaction[]>(MOCK_TRANSACTIONS);
  const [budgets, setBudgets] = useState<Budget[]>(MOCK_BUDGETS);

  function addTransaction(t: Omit<Transaction, "id">) {
    setTransactions(prev => [{ ...t, id: ++nextId }, ...prev]);
  }

  function deleteTransaction(id: number) {
    setTransactions(prev => prev.filter(t => t.id !== id));
  }

  return (
    <AppContext.Provider value={{
      categories: MOCK_CATEGORIES,
      transactions,
      budgets,
      setBudgets,
      addTransaction,
      deleteTransaction,
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
