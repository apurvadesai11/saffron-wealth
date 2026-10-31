"use client";

import { useApp } from "@/lib/app-context";

export default function SummaryCards() {
  const { transactions } = useApp();

  const totalIncome   = transactions.filter(t => t.type === "income").reduce((sum, t) => sum + t.amount, 0);
  const totalExpenses = transactions.filter(t => t.type === "expense").reduce((sum, t) => sum + t.amount, 0);
  const balance = totalIncome - totalExpenses;

  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="bg-surface rounded-xl p-4 shadow-sm border border-line-subtle">
        <p className="text-sm text-fg-muted mb-1">Balance</p>
        <p className={`text-2xl font-bold ${balance >= 0 ? "text-success" : "text-danger"}`}>
          ${balance.toFixed(2)}
        </p>
      </div>
      <div className="bg-surface rounded-xl p-4 shadow-sm border border-line-subtle">
        <p className="text-sm text-fg-muted mb-1">Income</p>
        <p className="text-2xl font-bold text-success">${totalIncome.toFixed(2)}</p>
      </div>
      <div className="bg-surface rounded-xl p-4 shadow-sm border border-line-subtle">
        <p className="text-sm text-fg-muted mb-1">Expenses</p>
        <p className="text-2xl font-bold text-danger">${totalExpenses.toFixed(2)}</p>
      </div>
    </div>
  );
}
