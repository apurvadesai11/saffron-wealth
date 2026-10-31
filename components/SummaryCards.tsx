"use client";

import { useApp } from "@/lib/app-context";
import { formatUsd } from "@/lib/money";

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
          {formatUsd(balance)}
        </p>
      </div>
      <div className="bg-surface rounded-xl p-4 shadow-sm border border-line-subtle">
        <p className="text-sm text-fg-muted mb-1">Income</p>
        <p className="text-2xl font-bold text-success">{formatUsd(totalIncome)}</p>
      </div>
      <div className="bg-surface rounded-xl p-4 shadow-sm border border-line-subtle">
        <p className="text-sm text-fg-muted mb-1">Expenses</p>
        <p className="text-2xl font-bold text-danger">{formatUsd(totalExpenses)}</p>
      </div>
    </div>
  );
}
