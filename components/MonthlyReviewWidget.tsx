"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useApp } from "@/lib/app-context";
import { formatUsd } from "@/lib/money";
import { useAlertState, getAsOf } from "@/lib/use-alert-state";
import {
  buildBudgetProgressList,
  getCurrentPeriodSpend,
  getPeriodSpendByCategory,
  getHistoricalAverage,
  getPeriodKey,
} from "@/lib/budget-utils";
import BudgetCategoryList from "./BudgetCategoryList";
import BudgetEditModal from "./BudgetEditModal";
import MonthNavigator from "./MonthNavigator";
import { EMPTY_FILTERS, filtersToSearchParams } from "./TransactionFilters";

type WidgetTab = "cashflow" | "budget";

const NO_DATA_STATES = [
  { icon: "🌵", message: "Nothing to see here — this month is a financial desert." },
  { icon: "🦗", message: "Crickets. Not a single transaction this month." },
  { icon: "🕸️", message: "Cobwebs. This month has been gathering dust." },
  { icon: "🌙", message: "A quiet month. No transactions on record." },
  { icon: "🐚", message: "Still as the sea. No transactions this month." },
];

function getNoDataState(month: number, year: number) {
  return NO_DATA_STATES[(month + year) % NO_DATA_STATES.length];
}

export default function MonthlyReviewWidget() {
  const now = new Date();
  const {
    categories, transactions, budgets, saveBudgets,
    transactionsFrom, ensureTransactionsFrom,
  } = useApp();
  const { clearDismissedThresholds } = useAlertState();

  const expenseCategories = categories.filter(c => c.type === "expense");

  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear]   = useState(now.getFullYear());
  // Cashflow is listed first, so it's the tab the widget opens on.
  const [widgetTab, setWidgetTab] = useState<WidgetTab>("cashflow");
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);

  const asOf = useMemo(() => getAsOf(month, year), [month, year]);

  async function handleSave(categoryId: string, amount: number) {
    const oldBudget = budgets.find(b => b.categoryId === categoryId && b.period === "monthly");

    try {
      await saveBudgets([{ categoryId, amount, period: "monthly" }]);
    } catch (e) {
      console.error("Failed to save budget", e);
      return;
    }

    // FR-19: if budget increased and spend drops below a dismissed threshold,
    // clear the dismissed key so the alert can re-appear if crossed again
    if (oldBudget && amount > oldBudget.amount) {
      const spent = getCurrentPeriodSpend(transactions, categoryId, "monthly", asOf);
      const newPercent = (spent / amount) * 100;
      const periodKey = getPeriodKey(asOf, "monthly");
      const thresholds: number[] = [];
      if (newPercent < 80)  thresholds.push(80);
      if (newPercent < 100) thresholds.push(100);
      if (thresholds.length) clearDismissedThresholds(categoryId, periodKey, thresholds);
    }

    setEditingCategoryId(null);
  }

  async function handleAutoSetAll() {
    const oldAmounts = new Map(
      budgets.filter(b => b.period === "monthly").map(b => [b.categoryId, b.amount])
    );

    const entries = categories.flatMap(cat => {
      const avg = getHistoricalAverage(transactions, cat.id, "monthly", asOf);
      if (!avg) return [];
      return [{ categoryId: cat.id, amount: Math.round(avg.average), period: "monthly" as const }];
    });
    if (entries.length === 0) return;

    try {
      await saveBudgets(entries);
    } catch (e) {
      console.error("Failed to auto-set budgets", e);
      return;
    }

    // FR-19: clear dismissed keys for categories where budget increased.
    // Batched: this sweep is per-entry, and Auto-Set All produces one entry
    // per category with history.
    const periodKey = getPeriodKey(asOf, "monthly");
    const spendByCategory = getPeriodSpendByCategory(transactions, "monthly", asOf);
    entries.forEach(({ categoryId, amount: newAmount }) => {
      const oldAmount = oldAmounts.get(categoryId);
      if (oldAmount !== undefined && newAmount > oldAmount) {
        const spent = spendByCategory.get(categoryId) ?? 0;
        const newPercent = (spent / newAmount) * 100;
        const thresholds: number[] = [];
        if (newPercent < 80)  thresholds.push(80);
        if (newPercent < 100) thresholds.push(100);
        if (thresholds.length) clearDismissedThresholds(categoryId, periodKey, thresholds);
      }
    });
  }

  // ── Derived budget data ────────────────────────────────────────────────
  const progressItems        = buildBudgetProgressList(categories, budgets, transactions, asOf);
  const expenseItems         = progressItems.filter(p => p.categoryType === "expense");
  const incomeItems          = progressItems.filter(p => p.categoryType === "income");
  const budgetedIds          = new Set(budgets.filter(b => b.period === "monthly").map(b => b.categoryId));
  const unbudgetedCategories = categories.filter(c => !budgetedIds.has(c.id));

  // ── Budget modal context ───────────────────────────────────────────────
  const editingCategory = editingCategoryId
    ? categories.find(c => c.id === editingCategoryId) ?? null
    : null;
  const editingBudget = editingCategoryId
    ? budgets.find(b => b.categoryId === editingCategoryId && b.period === "monthly")
    : undefined;
  const editingHistAvg = editingCategoryId
    ? getHistoricalAverage(transactions, editingCategoryId, "monthly", asOf)
    : null;

  // ── Month-filtered transactions (cashflow tab + spending breakdown) ───
  const monthPrefix       = `${year}-${String(month + 1).padStart(2, "0")}`;
  const monthTransactions = transactions.filter(t => t.date.startsWith(monthPrefix));
  const monthIncome       = monthTransactions.filter(t => t.type === "income").reduce((sum, t) => sum + t.amount, 0);
  const monthExpenses     = monthTransactions.filter(t => t.type === "expense").reduce((sum, t) => sum + t.amount, 0);
  const monthNet          = monthIncome - monthExpenses;

  const categoryTotals = expenseCategories
    .map(cat => ({
      categoryId: cat.id,
      name:       cat.name,
      color:      cat.color,
      amount:     monthTransactions
        .filter(t => t.type === "expense" && t.categoryId === cat.id)
        .reduce((sum, t) => sum + t.amount, 0),
    }))
    .filter(c => c.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  // AppProvider seeds a bounded window, so a month before its start has no
  // rows in state yet — indistinguishable from a month with no spending
  // unless we ask. Every figure below (Earned/Spent/Net, budget progress,
  // the category breakdown) would otherwise render as $0 for a month the
  // user actually spent money in.
  const monthStart = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const awaitingOlderData = transactionsFrom !== null && monthStart < transactionsFrom;

  useEffect(() => {
    if (awaitingOlderData) void ensureTransactionsFrom(monthStart);
    // ensureTransactionsFrom is re-created per render and de-dupes in-flight
    // ranges internally, so keying on the range alone is both sufficient and
    // necessary — including the function would re-run this every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaitingOlderData, monthStart]);

  // Last calendar day of the selected month, built in local time like the
  // rest of the period math; day 0 of next month is this month's last.
  const monthEnd = `${monthPrefix}-${String(new Date(year, month + 1, 0).getDate()).padStart(2, "0")}`;
  function transactionsHref(categoryId: string) {
    const params = filtersToSearchParams({
      ...EMPTY_FILTERS,
      categoryIds: [categoryId],
      dateFrom: monthStart,
      dateTo: monthEnd,
    });
    return `/transactions?${params.toString()}`;
  }

  const maxCategory = categoryTotals[0]?.amount ?? 0;
  const noData      = getNoDataState(month, year);

  return (
    <>
      <div className="bg-surface rounded-xl shadow-sm border border-line-subtle">
        <h2 className="text-lg font-semibold text-fg-soft px-5 pt-5 pb-3">
          Monthly Review
        </h2>

        <div className="border-t border-line-subtle" />

        {/* Header: tabs + shared month navigator */}
        <div className="flex items-center justify-between px-5 pt-3 pb-3">
          <div className="flex gap-1">
            {(["cashflow", "budget"] as WidgetTab[]).map(tab => (
              <button
                key={tab}
                onClick={() => setWidgetTab(tab)}
                aria-pressed={widgetTab === tab}
                className={`px-3 py-1.5 text-sm font-medium rounded-lg capitalize transition-colors ${
                  widgetTab === tab
                    ? "bg-surface-muted text-fg"
                    : "text-fg-faint hover:text-fg-secondary"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
          <MonthNavigator
            month={month}
            year={year}
            onChange={(m, y) => { setMonth(m); setYear(y); }}
          />
        </div>

        <div className="border-t border-line-subtle" />

        {awaitingOlderData ? (
          <div
            className="flex flex-col items-center justify-center py-12 px-6 text-center"
            aria-live="polite"
          >
            <p className="text-fg-faint text-sm">Loading earlier transactions…</p>
          </div>
        ) : (
        <>
        {/* Earned / Spent / Net */}
        <div className="grid grid-cols-3 gap-3 px-5 pt-4 pb-3">
          <div className="bg-success-soft rounded-lg p-3">
            <p className="text-xs text-success font-medium mb-1">Earned</p>
            <p className="text-lg font-bold text-success-strong">{formatUsd(monthIncome)}</p>
          </div>
          <div className="bg-danger-soft rounded-lg p-3">
            <p className="text-xs text-danger-muted font-medium mb-1">Spent</p>
            <p className="text-lg font-bold text-danger">{formatUsd(monthExpenses)}</p>
          </div>
          <div className={`rounded-lg p-3 ${monthNet >= 0 ? "bg-accent-soft" : "bg-caution-soft"}`}>
            <p className={`text-xs font-medium mb-1 ${monthNet >= 0 ? "text-accent-muted" : "text-caution-muted"}`}>Net</p>
            <p className={`text-lg font-bold ${monthNet >= 0 ? "text-accent-strong" : "text-caution"}`}>
              {monthNet >= 0 ? "+" : ""}{formatUsd(monthNet)}
            </p>
          </div>
        </div>

        <div className="border-t border-line-subtle" />

        {widgetTab === "budget" && (
          <div className="pb-4">
            {unbudgetedCategories.length > 0 && (
              <div className="flex items-center justify-between px-5 py-2.5 border-b border-line-faint">
                <p className="text-xs text-fg-faint">
                  {unbudgetedCategories.length} categor{unbudgetedCategories.length === 1 ? "y" : "ies"} without a budget
                </p>
                <button
                  onClick={handleAutoSetAll}
                  className="text-xs font-medium text-accent hover:text-accent-strong transition-colors"
                >
                  Auto-Set All
                </button>
              </div>
            )}

            {progressItems.length === 0 && unbudgetedCategories.length === 0 ? (
              <p className="text-sm text-fg-faint text-center py-10">No categories found.</p>
            ) : (
              <>
                <BudgetCategoryList label="Expenses" items={expenseItems} onEdit={setEditingCategoryId} />
                {expenseItems.length > 0 && incomeItems.length > 0 && (
                  <div className="border-t border-line-subtle my-2" />
                )}
                <BudgetCategoryList label="Income" items={incomeItems} onEdit={setEditingCategoryId} />
              </>
            )}

            {unbudgetedCategories.length > 0 && (
              <>
                {progressItems.length > 0 && <div className="border-t border-line-subtle my-2" />}
                <div className="px-5 pt-3 pb-1">
                  <p className="text-xs font-semibold text-fg-faint uppercase tracking-wide mb-2">
                    No Budget Set
                  </p>
                  <ul className="space-y-1">
                    {unbudgetedCategories.map(cat => (
                      <li key={cat.id}>
                        <button
                          onClick={() => setEditingCategoryId(cat.id)}
                          className="w-full flex items-center justify-between py-1.5 hover:bg-surface-sunken rounded-lg px-1 -mx-1 transition-colors"
                        >
                          <span className="text-sm text-fg-tertiary">{cat.name}</span>
                          <span className="text-sm text-accent-muted font-medium">+ Set Budget</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </div>
        )}

        {widgetTab === "cashflow" && (
          <div>
            {categoryTotals.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 px-6 text-center">
                <span className="text-4xl mb-3">{noData.icon}</span>
                <p className="text-fg-faint text-sm max-w-xs">{noData.message}</p>
              </div>
            ) : (
              <div className="px-5 py-5">
                <p className="text-xs font-semibold text-fg-faint uppercase tracking-wide mb-3">
                  Spending by Category
                </p>
                <ul className="space-y-3">
                  {categoryTotals.map(({ categoryId, name, color, amount }) => (
                    <li key={categoryId}>
                      <Link
                        href={transactionsHref(categoryId)}
                        className="block rounded-lg px-1 -mx-1 py-1 -my-1 hover:bg-surface-sunken transition-colors"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm text-fg-secondary">{name}</span>
                          <span className="text-sm font-semibold text-fg-soft">{formatUsd(amount)}</span>
                        </div>
                        <div className="w-full bg-surface-muted rounded-full h-1.5">
                          <div
                            className={`${color} h-1.5 rounded-full transition-all`}
                            style={{ width: `${(amount / maxCategory) * 100}%` }}
                          />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        </>
        )}
      </div>

      {editingCategory && (
        <BudgetEditModal
          category={editingCategory}
          currentBudget={editingBudget}
          historicalAverage={editingHistAvg}
          onSave={(amount) => handleSave(editingCategory.id, amount)}
          onClose={() => setEditingCategoryId(null)}
        />
      )}
    </>
  );
}
