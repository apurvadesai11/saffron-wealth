"use client";

import { useEffect, useMemo, useState } from "react";
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

type TransactionType = "expense" | "income";
type TxTab = "all" | "income" | "expenses";
type WidgetTab = "cashflow" | "budget";

const inputClass =
  "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

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

// Returns the reference date for budget calculations:
//   current month → now   |   past month → last day   |   future month → first day
function getAsOf(month: number, year: number): Date {
  const now = new Date();
  if (year === now.getFullYear() && month === now.getMonth()) return now;
  if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth())) {
    return new Date(year, month + 1, 0);
  }
  return new Date(year, month, 1);
}

export default function Home() {
  const now = new Date();
  const { categories, transactions, addTransaction, deleteTransaction, budgets, setBudgets } = useApp();

  const expenseCategories = categories.filter(c => c.type === "expense");
  const incomeCategories  = categories.filter(c => c.type === "income");

  // ── Shared month state (drives both widget tabs) ───────────────────────
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear]   = useState(now.getFullYear());

  const asOf = useMemo(() => getAsOf(month, year), [month, year]);
  const isCurrentMonth = month === now.getMonth() && year === now.getFullYear();

  // ── Widget + alert state ───────────────────────────────────────────────
  const [widgetTab, setWidgetTab]         = useState<WidgetTab>("budget");
  const [alertRecords, setAlertRecords]   = useState<AlertRecord[]>([]);
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(new Set());
  const [showAlertPanel, setShowAlertPanel] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);

  // ── Transaction form state ─────────────────────────────────────────────
  const [form, setForm] = useState({
    description: "",
    amount: "",
    categoryId: expenseCategories[0]?.id ?? "",
    type: "expense" as TransactionType,
    date: now.toISOString().split("T")[0],
  });
  const [showForm, setShowForm]   = useState(false);
  const [txTab, setTxTab]         = useState<TxTab>("all");

  // ── Alert evaluation (current month only) ─────────────────────────────
  useEffect(() => {
    if (!isCurrentMonth) return;

    setAlertRecords(prevRecords => {
      const newRecords: AlertRecord[] = [];
      const firedAt = new Date().toISOString();
      const period = "monthly" as const;

      categories
        .filter(cat => cat.type === "expense")
        .forEach(cat => {
          const budget = budgets.find(b => b.categoryId === cat.id && b.period === period);
          if (!budget || budget.amount === 0) return;

          const spent = getCurrentPeriodSpend(transactions, cat.id, period, asOf);
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

      return newRecords.length > 0 ? [...prevRecords, ...newRecords] : prevRecords;
    });
  }, [budgets, transactions, categories, asOf, isCurrentMonth]);

  // ── Budget handlers ────────────────────────────────────────────────────
  function handleSave(categoryId: string, amount: number) {
    const oldBudget = budgets.find(b => b.categoryId === categoryId && b.period === "monthly");
    const oldAmount = oldBudget?.amount;

    setBudgets(prev => {
      const idx = prev.findIndex(b => b.categoryId === categoryId && b.period === "monthly");
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], amount };
        return next;
      }
      return [...prev, { categoryId, amount, period: "monthly" }];
    });

    // FR-19: if budget increased, remove records where spend now falls below threshold
    if (amount > 0 && oldAmount !== undefined && amount > oldAmount) {
      const spent      = getCurrentPeriodSpend(transactions, categoryId, "monthly", asOf);
      const newPercent = (spent / amount) * 100;
      const periodKey  = getPeriodKey(asOf, "monthly");
      setAlertRecords(prev =>
        prev.filter(r => {
          if (r.categoryId !== categoryId || r.periodKey !== periodKey) return true;
          return newPercent >= r.threshold;
        })
      );
    }

    setEditingCategoryId(null);
  }

  function handleAutoSetAll() {
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
  }

  function handleDismissAlert(key: string) {
    setDismissedKeys(prev => new Set([...prev, key]));
  }

  // ── Derived budget data ────────────────────────────────────────────────
  const progressItems        = buildBudgetProgressList(categories, budgets, transactions, asOf);
  const expenseItems         = progressItems.filter(p => p.categoryType === "expense");
  const incomeItems          = progressItems.filter(p => p.categoryType === "income");
  const budgetedIds          = new Set(budgets.filter(b => b.period === "monthly").map(b => b.categoryId));
  const unbudgetedCategories = categories.filter(c => !budgetedIds.has(c.id));

  const activeAlerts: ActiveAlert[] = alertRecords
    .filter(r => {
      const key = `${r.categoryId}-${r.periodKey}-${r.threshold}`;
      if (dismissedKeys.has(key)) return false;
      const budget = budgets.find(b => b.categoryId === r.categoryId && b.period === "monthly");
      return budget && budget.amount > 0;
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

  // ── Month navigation ───────────────────────────────────────────────────
  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  }

  // ── Transaction derivations ────────────────────────────────────────────
  function handleTypeChange(type: TransactionType) {
    const first = (type === "expense" ? expenseCategories : incomeCategories)[0];
    setForm(prev => ({ ...prev, type, categoryId: first?.id ?? "" }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.description || !form.amount || !form.categoryId) return;
    addTransaction({
      description: form.description,
      amount:      parseFloat(form.amount),
      categoryId:  form.categoryId,
      type:        form.type,
      date:        form.date,
    });
    setForm(prev => ({ ...prev, description: "", amount: "" }));
    setShowForm(false);
  }

  function getCategoryName(categoryId: string) {
    return categories.find(c => c.id === categoryId)?.name ?? categoryId;
  }

  const totalIncome   = transactions.filter(t => t.type === "income").reduce((sum, t) => sum + t.amount, 0);
  const totalExpenses = transactions.filter(t => t.type === "expense").reduce((sum, t) => sum + t.amount, 0);
  const balance = totalIncome - totalExpenses;

  const visibleTransactions = transactions.filter(t => {
    if (txTab === "income")   return t.type === "income";
    if (txTab === "expenses") return t.type === "expense";
    return true;
  });

  // Month-filtered transactions (cashflow tab + spending breakdown)
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
  const formCategories = form.type === "expense" ? expenseCategories : incomeCategories;

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-gray-900">Saffron Wealth 💰</h1>

          <button
            onClick={() => setShowAlertPanel(prev => !prev)}
            className="relative p-2 rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            aria-label={`${activeAlerts.length} budget alert${activeAlerts.length === 1 ? "" : "s"}`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            {activeAlerts.length > 0 && (
              <span className="absolute top-0.5 right-0.5 min-w-[1rem] h-4 px-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
                {activeAlerts.length}
              </span>
            )}
          </button>
        </div>

        {/* ── Alert panel ─────────────────────────────────────────────── */}
        {showAlertPanel && (
          <div className="space-y-2">
            {activeAlerts.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-3 bg-white rounded-xl border border-gray-100">
                No active alerts.
              </p>
            ) : (
              <AlertPanel alerts={activeAlerts} onDismiss={handleDismissAlert} />
            )}
          </div>
        )}

        {/* ── Summary cards ────────────────────────────────────────────── */}
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

        {/* ── Combined Cashflow / Budget widget ───────────────────────── */}
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
            <div className="flex items-center gap-1">
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

          <div className="border-t border-gray-100" />

          {/* Earned / Spent / Net — pinned to top of both tabs */}
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

          {/* ── Budget tab ──────────────────────────────────────────── */}
          {widgetTab === "budget" && (
            <div className="pb-4">
              {/* Auto-Set All — only shown when there are unbudgeted categories */}
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

          {/* ── Cashflow tab ────────────────────────────────────────── */}
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

        {/* ── Transaction list ─────────────────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          <div className="flex items-center justify-between px-6 pt-6 pb-4">
            <h2 className="text-lg font-semibold text-gray-800">Transactions</h2>
            <button
              onClick={() => setShowForm(prev => !prev)}
              className="bg-blue-600 text-white rounded-lg py-1.5 px-4 text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              {showForm ? "Cancel" : "+ Add Transaction"}
            </button>
          </div>

          {showForm && (
            <div className="px-6 pb-6 border-b border-gray-100">
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                    <select
                      value={form.type}
                      onChange={e => handleTypeChange(e.target.value as TransactionType)}
                      className={inputClass}
                    >
                      <option value="expense">Expense</option>
                      <option value="income">Income</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                    <select
                      value={form.categoryId}
                      onChange={e => setForm(prev => ({ ...prev, categoryId: e.target.value }))}
                      className={inputClass}
                    >
                      {formCategories.map(cat => (
                        <option key={cat.id} value={cat.id}>{cat.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                    <input
                      type="text"
                      placeholder="e.g. Netflix subscription"
                      value={form.description}
                      onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
                      className={inputClass}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Amount ($)</label>
                    <input
                      type="number"
                      placeholder="0.00"
                      min="0.01"
                      step="0.01"
                      value={form.amount}
                      onChange={e => setForm(prev => ({ ...prev, amount: e.target.value }))}
                      className={inputClass}
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                  <input
                    type="date"
                    value={form.date}
                    onChange={e => setForm(prev => ({ ...prev, date: e.target.value }))}
                    className={inputClass}
                  />
                </div>
                <button
                  type="submit"
                  className="w-full bg-blue-600 text-white rounded-lg py-2 px-4 text-sm font-medium hover:bg-blue-700 transition-colors"
                >
                  Save Transaction
                </button>
              </form>
            </div>
          )}

          <div className="flex border-b border-gray-100 px-6">
            {(["all", "income", "expenses"] as TxTab[]).map(tab => (
              <button
                key={tab}
                onClick={() => setTxTab(tab)}
                className={`py-2 px-4 text-sm font-medium capitalize border-b-2 -mb-px transition-colors ${
                  txTab === tab
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-400 hover:text-gray-600"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {visibleTransactions.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-8">No transactions here yet.</p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {visibleTransactions.map(t => (
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
                    >
                      ✕
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

      </div>

      {/* ── Budget edit modal ─────────────────────────────────────────── */}
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
