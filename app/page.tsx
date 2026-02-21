"use client";

import { useState } from "react";

type Category = "Housing" | "Food" | "Transport" | "Entertainment" | "Income" | "Other";
type TransactionType = "expense" | "income";
type Tab = "all" | "income" | "expenses";

interface Transaction {
  id: number;
  description: string;
  amount: number;
  category: Category;
  type: TransactionType;
  date: string;
}

const CATEGORIES: Category[] = ["Housing", "Food", "Transport", "Entertainment", "Income", "Other"];

const inputClass = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

const CATEGORY_COLORS: Record<Category, string> = {
  Housing: "bg-violet-500",
  Food: "bg-orange-400",
  Transport: "bg-blue-400",
  Entertainment: "bg-pink-400",
  Income: "bg-green-500",
  Other: "bg-gray-400",
};

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

export default function Home() {
  const now = new Date();

  const [transactions, setTransactions] = useState<Transaction[]>([
    // February 2026
    { id: 1, description: "Rent", amount: 1500, category: "Housing", type: "expense", date: "2026-02-01" },
    { id: 2, description: "Groceries", amount: 120, category: "Food", type: "expense", date: "2026-02-05" },
    { id: 3, description: "Salary", amount: 4000, category: "Income", type: "income", date: "2026-02-01" },
    { id: 4, description: "Uber", amount: 45, category: "Transport", type: "expense", date: "2026-02-10" },
    { id: 5, description: "Netflix", amount: 18, category: "Entertainment", type: "expense", date: "2026-02-12" },
    // January 2026
    { id: 6, description: "Rent", amount: 1500, category: "Housing", type: "expense", date: "2026-01-01" },
    { id: 7, description: "Salary", amount: 4000, category: "Income", type: "income", date: "2026-01-01" },
    { id: 8, description: "Groceries", amount: 95, category: "Food", type: "expense", date: "2026-01-08" },
    { id: 9, description: "Train pass", amount: 120, category: "Transport", type: "expense", date: "2026-01-03" },
    { id: 10, description: "Concert tickets", amount: 210, category: "Entertainment", type: "expense", date: "2026-01-20" },
  ]);

  const [form, setForm] = useState({
    description: "",
    amount: "",
    category: "Food" as Category,
    type: "expense" as TransactionType,
    date: new Date().toISOString().split("T")[0],
  });

  const [showForm, setShowForm] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [reportMonth, setReportMonth] = useState(now.getMonth());
  const [reportYear, setReportYear] = useState(now.getFullYear());

  // --- Summary totals (all time) ---
  const totalIncome = transactions.filter(t => t.type === "income").reduce((sum, t) => sum + t.amount, 0);
  const totalExpenses = transactions.filter(t => t.type === "expense").reduce((sum, t) => sum + t.amount, 0);
  const balance = totalIncome - totalExpenses;

  // --- Transaction list tab filter ---
  const visibleTransactions = transactions.filter(t => {
    if (activeTab === "income") return t.type === "income";
    if (activeTab === "expenses") return t.type === "expense";
    return true;
  });

  // --- Cashflow report data ---
  const reportTransactions = transactions.filter(t => {
    const d = new Date(t.date);
    return d.getUTCMonth() === reportMonth && d.getUTCFullYear() === reportYear;
  });

  const reportIncome = reportTransactions.filter(t => t.type === "income").reduce((sum, t) => sum + t.amount, 0);
  const reportExpenses = reportTransactions.filter(t => t.type === "expense").reduce((sum, t) => sum + t.amount, 0);
  const reportNet = reportIncome - reportExpenses;

  const categoryTotals = CATEGORIES
    .filter(cat => cat !== "Income")
    .map(cat => ({
      category: cat,
      amount: reportTransactions
        .filter(t => t.type === "expense" && t.category === cat)
        .reduce((sum, t) => sum + t.amount, 0),
    }))
    .filter(c => c.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  const maxCategory = categoryTotals[0]?.amount ?? 0;

  function prevMonth() {
    if (reportMonth === 0) { setReportMonth(11); setReportYear(y => y - 1); }
    else setReportMonth(m => m - 1);
  }

  function nextMonth() {
    if (reportMonth === 11) { setReportMonth(0); setReportYear(y => y + 1); }
    else setReportMonth(m => m + 1);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.description || !form.amount) return;
    setTransactions([{ id: Date.now(), description: form.description, amount: parseFloat(form.amount), category: form.category, type: form.type, date: form.date }, ...transactions]);
    setForm({ ...form, description: "", amount: "" });
    setShowForm(false);
  }

  function handleDelete(id: number) {
    setTransactions(transactions.filter(t => t.id !== id));
  }

  const noData = getNoDataState(reportMonth, reportYear);

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className="text-3xl font-bold text-gray-900">Saffron Wealth</h1>

        {/* Summary Cards */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <p className="text-sm text-gray-500 mb-1">Balance</p>
            <p className={`text-2xl font-bold ${balance >= 0 ? "text-green-600" : "text-red-600"}`}>${balance.toFixed(2)}</p>
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

        {/* Monthly Cashflow Report */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          {/* Report Header */}
          <div className="flex items-center justify-between px-6 pt-6 pb-4">
            <h2 className="text-lg font-semibold text-gray-800">Monthly Cashflow</h2>
            <div className="flex items-center gap-3">
              <button onClick={prevMonth} className="text-gray-400 hover:text-gray-700 transition-colors text-lg leading-none">‹</button>
              <span className="text-sm font-medium text-gray-700 w-36 text-center">
                {MONTH_NAMES[reportMonth]} {reportYear}
              </span>
              <button onClick={nextMonth} className="text-gray-400 hover:text-gray-700 transition-colors text-lg leading-none">›</button>
            </div>
          </div>

          {reportTransactions.length === 0 ? (
            /* No Data State */
            <div className="flex flex-col items-center justify-center py-14 px-6 text-center">
              <span className="text-5xl mb-4">{noData.icon}</span>
              <p className="text-gray-400 text-sm max-w-xs">{noData.message}</p>
            </div>
          ) : (
            <div className="px-6 pb-6 space-y-5">
              {/* Income / Expense / Net row */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-green-50 rounded-lg p-3">
                  <p className="text-xs text-green-600 font-medium mb-1">Earned</p>
                  <p className="text-lg font-bold text-green-700">${reportIncome.toFixed(2)}</p>
                </div>
                <div className="bg-red-50 rounded-lg p-3">
                  <p className="text-xs text-red-500 font-medium mb-1">Spent</p>
                  <p className="text-lg font-bold text-red-600">${reportExpenses.toFixed(2)}</p>
                </div>
                <div className={`rounded-lg p-3 ${reportNet >= 0 ? "bg-blue-50" : "bg-orange-50"}`}>
                  <p className={`text-xs font-medium mb-1 ${reportNet >= 0 ? "text-blue-500" : "text-orange-500"}`}>Net</p>
                  <p className={`text-lg font-bold ${reportNet >= 0 ? "text-blue-700" : "text-orange-600"}`}>
                    {reportNet >= 0 ? "+" : ""}${reportNet.toFixed(2)}
                  </p>
                </div>
              </div>

              {/* Category Breakdown */}
              {categoryTotals.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Spending by Category</p>
                  <ul className="space-y-3">
                    {categoryTotals.map(({ category, amount }) => (
                      <li key={category}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm text-gray-700">{category}</span>
                          <span className="text-sm font-semibold text-gray-800">${amount.toFixed(2)}</span>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-1.5">
                          <div
                            className={`${CATEGORY_COLORS[category]} h-1.5 rounded-full transition-all`}
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

        {/* Transaction List */}
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
                    <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value as TransactionType })} className={inputClass}>
                      <option value="expense">Expense</option>
                      <option value="income">Income</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                    <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value as Category })} className={inputClass}>
                      {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                    <input type="text" placeholder="e.g. Netflix subscription" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className={inputClass} required />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Amount ($)</label>
                    <input type="number" placeholder="0.00" min="0.01" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} className={inputClass} required />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                  <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className={inputClass} />
                </div>
                <button type="submit" className="w-full bg-blue-600 text-white rounded-lg py-2 px-4 text-sm font-medium hover:bg-blue-700 transition-colors">
                  Save Transaction
                </button>
              </form>
            </div>
          )}

          <div className="flex border-b border-gray-100 px-6">
            {(["all", "income", "expenses"] as Tab[]).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`py-2 px-4 text-sm font-medium capitalize border-b-2 -mb-px transition-colors ${activeTab === tab ? "border-blue-600 text-blue-600" : "border-transparent text-gray-400 hover:text-gray-600"}`}
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
                      <p className="text-xs text-gray-400">{t.category} · {t.date}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-sm font-semibold ${t.type === "income" ? "text-green-600" : "text-red-600"}`}>
                      {t.type === "income" ? "+" : "-"}${t.amount.toFixed(2)}
                    </span>
                    <button onClick={() => handleDelete(t.id)} className="text-gray-300 hover:text-red-400 transition-colors text-xs">✕</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

      </div>
    </div>
  );
}
