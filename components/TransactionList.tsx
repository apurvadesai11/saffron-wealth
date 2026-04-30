"use client";

import { useApp } from "@/lib/app-context";
import type { Transaction } from "@/lib/types";

interface Props {
  transactions: Transaction[];
}

export default function TransactionList({ transactions }: Props) {
  const { categories, deleteTransaction } = useApp();

  function getCategoryName(categoryId: string) {
    return categories.find(c => c.id === categoryId)?.name ?? categoryId;
  }

  if (transactions.length === 0) {
    return <p className="text-gray-400 text-sm text-center py-8">No transactions match these filters.</p>;
  }

  return (
    <ul className="divide-y divide-gray-50">
      {transactions.map(t => (
        <li key={t.id} className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className={`w-2 h-2 rounded-full ${t.type === "income" ? "bg-green-500" : "bg-red-500"}`} />
            <div>
              <p className="text-sm font-medium text-gray-800">{t.description}</p>
              <p className="text-xs text-gray-400">{getCategoryName(t.categoryId)} · {t.date}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-sm font-semibold ${t.type === "income" ? "text-green-600" : "text-red-600"}`}>
              {t.type === "income" ? "+" : "-"}${t.amount.toFixed(2)}
            </span>
            <button
              onClick={() => deleteTransaction(t.id)}
              className="text-gray-300 hover:text-red-400 transition-colors text-xs"
              aria-label={`Delete ${t.description}`}
            >
              ✕
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
