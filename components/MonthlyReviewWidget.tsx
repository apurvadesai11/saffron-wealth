"use client";

import { useMemo, useState } from "react";
import { useApp } from "@/lib/app-context";
import { useAlertState, getAsOf } from "@/lib/use-alert-state";
import {
  buildBudgetProgressList,
  getCurrentPeriodSpend,
  getHistoricalAverage,
  getPeriodKey,
} from "@/lib/budget-utils";
import BudgetCategoryList from "./BudgetCategoryList";
import BudgetEditModal from "./BudgetEditModal";
import MonthNavigator from "./MonthNavigator";

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
  const { categories, transactions, budgets, setBudgets } = useApp();
  const { clearDismissedThresholds } = useAlertState();

  const expenseCategories = categories.filter(c => c.type === "expense");

  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear]   = useState(now.getFullYear());
  const [widgetTab, setWidgetTab] = useState<WidgetTab>("budget");
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);

  const asOf = useMemo(() => getAsOf(month, year), [month, year]);

  function handleSave(categoryId: string, amount: number) {
    const oldBudget = budgets.find(b => b.categoryId === categoryId && b.period === "monthly");

    setBudgets(prev => {
      const idx = prev.findIndex(b => b.categoryId === categoryId && b.period === "monthly");
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], amount };
        return next;
      }
      return [...prev, { categoryId, amount, period: "monthly" }];
    });

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

  function handleAutoSetAll() {
    const oldAmounts = new Map(
      budgets.filter(b => b.period === "monthly").map(b => [b.categoryId, b.amount])
    );

    setBudgets(prev => {
      const next = [...prev];
      categories.forEach(cat => {
        const avg = getHistoricalAverage(transactions, cat.id, "monthly", asOf);
        if (!avg) return;
        const rounded = Math.round(avg.average);
        const idx = next.findIndex(b => b.categoryId === cat.id && b.period === "monthly");
        if (idx >= 0) {
          next[idx] = { ...next[idx], amount: rounded };
        } else {
          next.push({ categoryId: cat.id, amount: rounded, period: "monthly" });
        }
      });
      return next;
    });

    // FR-19: clear dismissed keys for categories where budget increased
    const periodKey = getPeriodKey(asOf, "monthly");
    categories.forEach(cat => {
      const avg = getHistoricalAverage(transactions, cat.id, "monthly", asOf);
      if (!avg) return;
      const newAmount = Math.round(avg.average);
      const oldAmount = oldAmounts.get(cat.id);
      if (oldAmount !== undefined && newAmount > oldAmount) {
        const spent = getCurrentPeriodSpend(transactions, cat.id, "monthly", asOf);
        const newPercent = (spent / newAmount) * 100;
        const thresholds: number[] = [];
        if (newPercent < 80)  thresholds.push(80);
        if (newPercent < 100) thresholds.push(100);
        if (thresholds.length) clearDismissedThresholds(cat.id, periodKey, thresholds);
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

  const maxCategory = categoryTotals[0]?.amount ?? 0;
  const noData      = getNoDataState(month, year);

  return (
    <>
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <h2 className="text-lg font-semibold text-gray-800 px-5 pt-5 pb-3">
          Monthly Review
        </h2>

        <div className="border-t border-gray-100" />

        {/* Header: tabs + shared month navigator */}
        <div className="flex items-center justify-between px-5 pt-3 pb-3">
          <div className="flex gap-1">
            {(["budget", "cashflow"] as WidgetTab[]).map(tab => (
              <button
                key={tab}
                onClick={() => setWidgetTab(tab)}
                className={`px-3 py-1.5 text-sm font-medium rounded-lg capitalize transition-colors ${
                  widgetTab === tab
                    ? "bg-gray-100 text-gray-900"
                    : "text-gray-400 hover:text-gray-700"
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

        <div className="border-t border-gray-100" />

        {/* Earned / Spent / Net */}
        <div className="grid grid-cols-3 gap-3 px-5 pt-4 pb-3">
          <div className="bg-green-50 rounded-lg p-3">
            <p className="text-xs text-green-600 font-medium mb-1">Earned</p>
            <p className="text-lg font-bold text-green-700">${monthIncome.toFixed(2)}</p>
          </div>
          <div className="bg-red-50 rounded-lg p-3">
            <p className="text-xs text-red-500 font-medium mb-1">Spent</p>
            <p className="text-lg font-bold text-red-600">${monthExpenses.toFixed(2)}</p>
          </div>
          <div className={`rounded-lg p-3 ${monthNet >= 0 ? "bg-blue-50" : "bg-orange-50"}`}>
            <p className={`text-xs font-medium mb-1 ${monthNet >= 0 ? "text-blue-500" : "text-orange-500"}`}>Net</p>
            <p className={`text-lg font-bold ${monthNet >= 0 ? "text-blue-700" : "text-orange-600"}`}>
              {monthNet >= 0 ? "+" : ""}${monthNet.toFixed(2)}
            </p>
          </div>
        </div>

        <div className="border-t border-gray-100" />

        {widgetTab === "budget" && (
          <div className="pb-4">
            {unbudgetedCategories.length > 0 && (
              <div className="flex items-center justify-between px-5 py-2.5 border-b border-gray-50">
                <p className="text-xs text-gray-400">
                  {unbudgetedCategories.length} categor{unbudgetedCategories.length === 1 ? "y" : "ies"} without a budget
                </p>
                <button
                  onClick={handleAutoSetAll}
                  className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors"
                >
                  Auto-Set All
                </button>
              </div>
            )}

            {progressItems.length === 0 && unbudgetedCategories.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-10">No categories found.</p>
            ) : (
              <>
                <BudgetCategoryList label="Expenses" items={expenseItems} onEdit={setEditingCategoryId} />
                {expenseItems.length > 0 && incomeItems.length > 0 && (
                  <div className="border-t border-gray-100 my-2" />
                )}
                <BudgetCategoryList label="Income" items={incomeItems} onEdit={setEditingCategoryId} />
              </>
            )}

            {unbudgetedCategories.length > 0 && (
              <>
                {progressItems.length > 0 && <div className="border-t border-gray-100 my-2" />}
                <div className="px-5 pt-3 pb-1">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                    No Budget Set
                  </p>
                  <ul className="space-y-1">
                    {unbudgetedCategories.map(cat => (
                      <li key={cat.id}>
                        <button
                          onClick={() => setEditingCategoryId(cat.id)}
                          className="w-full flex items-center justify-between py-1.5 hover:bg-gray-50 rounded-lg px-1 -mx-1 transition-colors"
                        >
                          <span className="text-sm text-gray-600">{cat.name}</span>
                          <span className="text-sm text-blue-500 font-medium">+ Set Budget</span>
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
                <p className="text-gray-400 text-sm max-w-xs">{noData.message}</p>
              </div>
            ) : (
              <div className="px-5 py-5">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                  Spending by Category
                </p>
                <ul className="space-y-3">
                  {categoryTotals.map(({ categoryId, name, color, amount }) => (
                    <li key={categoryId}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-gray-700">{name}</span>
                        <span className="text-sm font-semibold text-gray-800">${amount.toFixed(2)}</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-1.5">
                        <div
                          className={`${color} h-1.5 rounded-full transition-all`}
                          style={{ width: `${(amount / maxCategory) * 100}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
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
