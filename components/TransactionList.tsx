"use client";

import { useApp } from "@/lib/app-context";
import type { Transaction } from "@/lib/types";
import { formatUsd } from "@/lib/money";

interface Props {
  transactions: Transaction[];
}

export default function TransactionList({ transactions }: Props) {
  const { categories, deleteTransaction } = useApp();

  function getCategoryName(categoryId: string) {
    return categories.find(c => c.id === categoryId)?.name ?? categoryId;
  }

  if (transactions.length === 0) {
    return <p className="text-fg-faint text-sm text-center py-8">No transactions match these filters.</p>;
  }

  return (
    <ul className="divide-y divide-line-faint">
      {transactions.map(t => (
        <li key={t.id} className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className={`w-2 h-2 rounded-full ${t.type === "income" ? "bg-data-good" : "bg-data-over"}`} />
            <div>
              <p className="text-sm font-medium text-fg-soft">{t.description}</p>
              <p className="text-xs text-fg-faint">{getCategoryName(t.categoryId)} · {t.date}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-sm font-semibold ${t.type === "income" ? "text-success" : "text-danger"}`}>
              {t.type === "income" ? "+" : "-"}{formatUsd(t.amount)}
            </span>
            <button
              onClick={() => {
                deleteTransaction(t.id).catch(e => console.error("Failed to delete transaction", e));
              }}
              // Same two defects as AccountRow's control had (item 14b):
              // text-fg-disabled is ~1.5:1 on surface, under WCAG 1.4.11's 3:1 for
              // a non-text control, and the bare glyph reserved roughly 10px
              // against SC 2.5.8's 24x24 minimum. The wording stays "Delete"
              // because deleteTransaction really does remove the row — unlike
              // an account archive, this one is not recoverable.
              className="min-h-6 min-w-6 flex items-center justify-center rounded text-xs text-fg-muted hover:text-danger hover:bg-surface-muted transition-colors"
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
