"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertRecord } from "@/lib/types";
import { useApp } from "@/lib/app-context";
import {
  buildBudgetProgressList,
  formatAlertMessage,
  getCurrentPeriodSpend,
  getDaysRemainingInPeriod,
  getHistoricalAverage,
  getPendingAlerts,
  getPeriodKey,
} from "@/lib/budget-utils";
import BudgetCategoryList from "@/components/BudgetCategoryList";
import BudgetEditModal from "@/components/BudgetEditModal";
import AlertPanel, { ActiveAlert } from "@/components/AlertPanel";
import CashflowCard from "@/components/CashflowCard";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function getAsOf(month: number, year: number): Date {
  const now = new Date();
  if (year === now.getFullYear() && month === now.getMonth()) return now;
  if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth())) {
    return new Date(year, month + 1, 0);
  }
  return new Date(year, month, 1);
}

export default function BudgetPage() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear]   = useState(now.getFullYear());

  // Memoize asOf so useEffect deps don't flap on every render
  // (getAsOf returns new Date() for current month, which would otherwise change each render)
  const asOf = useMemo(() => getAsOf(month, year), [month, year]);

  const isCurrentMonth = month === now.getMonth() && year === now.getFullYear();

  // ── Shared app state (transactions + budgets live in context) ─────────
  const { transactions, budgets, setBudgets, categories } = useApp();

  // ── Local UI state ─────────────────────────────────────────────────────
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);

  // Alert records: one entry per category × period × threshold that has fired
  const [alertRecords, setAlertRecords]     = useState<AlertRecord[]>([]);
  // Keys of alerts the user has manually dismissed this session
  const [dismissedKeys, setDismissedKeys]   = useState<Set<string>>(new Set());

  // ── Alert evaluation (FR-15, FR-16) ────────────────────────────────────
  // Runs when budgets change or when the user navigates to the current month.
  // Uses functional setState to always see the latest records and avoid loops.
  useEffect(() => {
    if (!isCurrentMonth) return; // only fire alerts for the live month

    setAlertRecords(prevRecords => {
      const newRecords: AlertRecord[] = [];
      const firedAt = new Date().toISOString();
      const period = "monthly" as const;

      categories
        .filter(cat => cat.type === "expense")
        .forEach(cat => {
          const budget = budgets.find(
            b => b.categoryId === cat.id && b.period === period
          );
          if (!budget || budget.amount === 0) return;

          const spent = getCurrentPeriodSpend(transactions, cat.id, period, asOf);

          // Pass prevRecords + already-accumulated newRecords to avoid double-firing
          // within the same evaluation pass (e.g. if both 80% and 100% are pending)
          const pending = getPendingAlerts(
            spent, budget, [...prevRecords, ...newRecords], cat.id, asOf
          );

          pending.forEach(threshold => {
            newRecords.push({
              categoryId: cat.id,
              periodKey:  getPeriodKey(asOf, period),
              threshold,
              firedAt,
            });
          });
        });

      return newRecords.length > 0
        ? [...prevRecords, ...newRecords]
        : prevRecords; // return same reference if nothing new → no re-render
    });
  }, [budgets, asOf, isCurrentMonth]);

  // ── Derived display data ───────────────────────────────────────────────
  const progressItems = buildBudgetProgressList(
    categories, budgets, transactions, asOf
  );
  const expenseItems = progressItems.filter(p => p.categoryType === "expense");
  const incomeItems  = progressItems.filter(p => p.categoryType === "income");

  const budgetedIds = new Set(
    budgets.filter(b => b.period === "monthly").map(b => b.categoryId)
  );
  const unbudgetedCategories = categories.filter(c => !budgetedIds.has(c.id));

  // Active alerts: fired + not dismissed + category still has a positive budget
  const activeAlerts: ActiveAlert[] = alertRecords
    .filter(r => {
      const key = `${r.categoryId}-${r.periodKey}-${r.threshold}`;
      if (dismissedKeys.has(key)) return false;
      const budget = budgets.find(b => b.categoryId === r.categoryId && b.period === "monthly");
      return budget && budget.amount > 0; // hide if category was subsequently hidden
    })
    .map(r => {
      const cat    = categories.find(c => c.id === r.categoryId)!;
      const budget = budgets.find(b => b.categoryId === r.categoryId && b.period === "monthly")!;
      const spent  = getCurrentPeriodSpend(transactions, r.categoryId, "monthly", asOf);
      const days   = getDaysRemainingInPeriod(asOf, "monthly");
      return {
        key:       `${r.categoryId}-${r.periodKey}-${r.threshold}`,
        threshold: r.threshold,
        message:   formatAlertMessage(r.threshold, cat.name, spent, budget.amount, days),
      };
    });

  // ── Handlers ──────────────────────────────────────────────────────────

  function handleSave(categoryId: string, amount: number) {
    const oldBudget = budgets.find(b => b.categoryId === categoryId && b.period === "monthly");
    const oldAmount = oldBudget?.amount;

    setBudgets(prev => {
      const idx = prev.findIndex(
        b => b.categoryId === categoryId && b.period === "monthly"
      );
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], amount };
        return next;
      }
      return [...prev, { categoryId, amount, period: "monthly" }];
    });

    // FR-19: when budget is increased such that current spend drops below a
    // previously-fired threshold, remove that AlertRecord so the alert resets
    // and can re-fire if the threshold is crossed again.
    if (amount > 0 && oldAmount !== undefined && amount > oldAmount) {
      const spent      = getCurrentPeriodSpend(transactions, categoryId, "monthly", asOf);
      const newPercent = (spent / amount) * 100;
      const periodKey  = getPeriodKey(asOf, "monthly");

      setAlertRecords(prev =>
        prev.filter(r => {
          if (r.categoryId !== categoryId || r.periodKey !== periodKey) return true;
          // Keep record only if spend still exceeds this threshold at the new budget
          return newPercent >= r.threshold;
        })
      );
    }

    setEditingCategoryId(null);
  }

  // FR-07, US-01: auto-set all categories to their 12-month historical average
  function handleAutoSetAll() {
    setBudgets(prev => {
      const next = [...prev];
      categories.forEach(cat => {
        const avg = getHistoricalAverage(transactions, cat.id, "monthly", asOf);
        if (!avg) return;
        const rounded = Math.round(avg.average);
        const idx = next.findIndex(
          b => b.categoryId === cat.id && b.period === "monthly"
        );
        if (idx >= 0) {
          next[idx] = { ...next[idx], amount: rounded };
        } else {
          next.push({ categoryId: cat.id, amount: rounded, period: "monthly" });
        }
      });
      return next;
      // TODO (Phase 4 follow-up): apply FR-19 reset per-category after auto-set,
      // same as in handleSave, for any category whose budget increased.
    });
  }

  function handleDismissAlert(key: string) {
    setDismissedKeys(prev => new Set([...prev, key]));
  }

  // ── Modal context ─────────────────────────────────────────────────────
  const editingCategory = editingCategoryId
    ? categories.find(c => c.id === editingCategoryId) ?? null
    : null;
  const editingBudget = editingCategoryId
    ? budgets.find(b => b.categoryId === editingCategoryId && b.period === "monthly")
    : undefined;
  const editingHistAvg = editingCategoryId
    ? getHistoricalAverage(transactions, editingCategoryId, "monthly", asOf)
    : null;

  // ── Navigation ────────────────────────────────────────────────────────
  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* ── Page header ───────────────────────────────────────────── */}
        <div className="flex items-start justify-between">
          <div>
            <Link
              href="/"
              className="text-sm text-gray-400 hover:text-gray-600 transition-colors mb-1 block"
            >
              ← Saffron Wealth
            </Link>
            <h1 className="text-2xl font-bold text-gray-900">Monthly Budget</h1>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <button
              onClick={prevMonth}
              className="text-gray-400 hover:text-gray-700 transition-colors text-xl leading-none px-1"
              aria-label="Previous month"
            >‹</button>
            <span className="text-sm font-medium text-gray-700 w-32 text-center">
              {MONTH_NAMES[month]} {year}
            </span>
            <button
              onClick={nextMonth}
              className="text-gray-400 hover:text-gray-700 transition-colors text-xl leading-none px-1"
              aria-label="Next month"
            >›</button>
          </div>
        </div>

        {/* ── Alert panel (FR-15 – FR-18) ────────────────────────────── */}
        <AlertPanel alerts={activeAlerts} onDismiss={handleDismissAlert} />

        {/* ── Cashflow forecast (FR-20 – FR-24) ─────────────────────── */}
        <CashflowCard
          transactions={transactions}
          budgets={budgets}
          categories={categories}
          asOf={asOf}
        />

        {/* ── Auto-Set All + hint ────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">
            Tap any category to edit its budget.
          </p>
          <button
            onClick={handleAutoSetAll}
            className="text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors border border-blue-200 rounded-lg px-3 py-1.5 hover:bg-blue-50"
          >
            Auto-Set All
          </button>
        </div>

        {/* ── Budgeted category lists ────────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 pb-4">
          {progressItems.length === 0 && unbudgetedCategories.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-12">
              No categories found.
            </p>
          ) : (
            <>
              <BudgetCategoryList
                label="Expenses"
                items={expenseItems}
                onEdit={setEditingCategoryId}
              />
              {expenseItems.length > 0 && incomeItems.length > 0 && (
                <div className="border-t border-gray-100 my-2" />
              )}
              <BudgetCategoryList
                label="Income"
                items={incomeItems}
                onEdit={setEditingCategoryId}
              />
            </>
          )}

          {unbudgetedCategories.length > 0 && (
            <>
              {progressItems.length > 0 && <div className="border-t border-gray-100 my-2" />}
              <div className="px-6 pt-4 pb-2">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                  No Budget Set
                </p>
                <ul className="space-y-2">
                  {unbudgetedCategories.map(cat => (
                    <li key={cat.id}>
                      <button
                        onClick={() => setEditingCategoryId(cat.id)}
                        className="w-full flex items-center justify-between py-2 hover:bg-gray-50 rounded-lg px-1 -mx-1 transition-colors"
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

      </div>

      {/* ── Edit modal ───────────────────────────────────────────────── */}
      {editingCategory && (
        <BudgetEditModal
          category={editingCategory}
          currentBudget={editingBudget}
          historicalAverage={editingHistAvg}
          onSave={(amount) => handleSave(editingCategory.id, amount)}
          onClose={() => setEditingCategoryId(null)}
        />
      )}
    </div>
  );
}
