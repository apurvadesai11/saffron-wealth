"use client";

import { Fragment } from "react";
import { useApp } from "@/lib/app-context";
import type { Transaction } from "@/lib/types";
import { formatUsd } from "@/lib/money";

const MONTH_LABEL = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });

// "2026-10" → "October 2026". Built as a local date, since this is calendar
// display; the string never crosses back into persistence.
function monthLabel(yearMonth: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  return MONTH_LABEL.format(new Date(year, month - 1, 1));
}

interface Props {
  transactions: Transaction[];
  // The page owns the edit dialog, as NetWorthClient does for accounts.
  onEdit: (transaction: Transaction) => void;
}

export default function TransactionList({ transactions, onEdit }: Props) {
  const { categories, deleteTransaction } = useApp();

  function getCategoryName(categoryId: string) {
    return categories.find(c => c.id === categoryId)?.name ?? categoryId;
  }

  if (transactions.length === 0) {
    return <p className="text-fg-faint text-sm text-center py-8">No transactions match these filters.</p>;
  }

  return (
    <ul className="divide-y divide-line-faint">
      {transactions.map((t, i) => {
        // Rows arrive newest-first, so a month starts wherever it differs from
        // the row above; comparing across the whole list (not per page) keeps
        // "Load more" from repeating a divider at a page boundary.
        const month = t.date.slice(0, 7);
        const startsMonth = i === 0 || transactions[i - 1].date.slice(0, 7) !== month;
        return (
          <Fragment key={t.id}>
            {startsMonth && (
              <li data-month={month} className="px-6 py-2 bg-surface-sunken">
                <h3 className="text-xs font-semibold text-fg-muted uppercase tracking-wide">
                  {monthLabel(month)}
                </h3>
              </li>
            )}
            <li className="flex items-center justify-between px-6 py-4">
              {/* The whole left side opens the editor, the same target AccountRow
                  uses. The delete control is a sibling, so its click never
                  reaches this one. */}
              <button
                onClick={() => onEdit(t)}
                className="flex-1 flex items-center gap-3 text-left hover:opacity-80 transition-opacity"
                aria-label={`Edit ${t.description}`}
              >
                <div className={`w-2 h-2 rounded-full ${t.type === "income" ? "bg-data-good" : "bg-data-over"}`} />
                <div>
                  <p className="text-sm font-medium text-fg-soft">{t.description}</p>
                  <p className="text-xs text-fg-faint">{getCategoryName(t.categoryId)} · {t.date}</p>
                </div>
              </button>
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
          </Fragment>
        );
      })}
    </ul>
  );
}
