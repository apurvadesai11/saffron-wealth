"use client";

import { useMemo, useState } from "react";
import { useApp } from "@/lib/app-context";
import TransactionForm from "@/components/TransactionForm";
import TransactionList from "@/components/TransactionList";
import TransactionFilters, {
  EMPTY_FILTERS,
  TransactionFilterState,
} from "@/components/TransactionFilters";
import MonarchImportModal from "@/components/MonarchImportModal";

export default function TransactionsPage() {
  const { categories, transactions } = useApp();
  const [showForm, setShowForm] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [filters, setFilters] = useState<TransactionFilterState>(EMPTY_FILTERS);

  const visible = useMemo(
    () =>
      transactions.filter(t => {
        if (filters.type !== "all" && t.type !== filters.type) return false;
        if (filters.categoryIds.length && !filters.categoryIds.includes(t.categoryId)) return false;
        if (filters.dateFrom && t.date < filters.dateFrom) return false;
        if (filters.dateTo && t.date > filters.dateTo) return false;
        if (filters.amountMin) {
          const min = parseFloat(filters.amountMin);
          if (!isNaN(min) && t.amount < min) return false;
        }
        if (filters.amountMax) {
          const max = parseFloat(filters.amountMax);
          if (!isNaN(max) && t.amount > max) return false;
        }
        if (filters.search) {
          const q = filters.search.toLowerCase();
          const cat = categories.find(c => c.id === t.categoryId);
          if (
            !t.description.toLowerCase().includes(q) &&
            !(cat?.name.toLowerCase().includes(q) ?? false)
          ) {
            return false;
          }
        }
        return true;
      }),
    [transactions, filters, categories],
  );

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
            <p className="text-xs text-gray-400 mt-0.5">
              {visible.length} of {transactions.length} {transactions.length === 1 ? "transaction" : "transactions"}
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

        <TransactionList transactions={visible} />
      </div>

      {showImportModal && (
        <MonarchImportModal onClose={() => setShowImportModal(false)} />
      )}
    </>
  );
}
