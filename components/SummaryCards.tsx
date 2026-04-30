"use client";

import { useApp } from "@/lib/app-context";

export default function SummaryCards() {
  const { transactions } = useApp();

  const totalIncome   = transactions.filter(t => t.type === "income").reduce((sum, t) => sum + t.amount, 0);
  const totalExpenses = transactions.filter(t => t.type === "expense").reduce((sum, t) => sum + t.amount, 0);
  const balance = totalIncome - totalExpenses;

  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
        <p className="text-sm text-gray-500 mb-1">Balance</p>
        <p className={`text-2xl font-bold ${balance >= 0 ? "text-green-600" : "text-red-600"}`}>
          ${balance.toFixed(2)}
        </p>
      </div>
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
        <p className="text-sm text-gray-500 mb-1">Income</p>
        <p className="text-2xl font-bold text-green-600">${totalIncome.toFixed(2)}</p>
      </div>
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
        <p className="text-sm text-gray-500 mb-1">Expenses</p>
        <p className="text-2xl font-bold text-red-600">${totalExpenses.toFixed(2)}</p>
      </div>
    </div>
  );
}
