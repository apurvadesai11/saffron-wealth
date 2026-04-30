"use client";

import { useState } from "react";
import { useApp } from "@/lib/app-context";
import type { CategoryType } from "@/lib/types";

const inputClass =
  "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500";

interface Props {
  onSubmitted?: () => void;
}

export default function TransactionForm({ onSubmitted }: Props) {
  const { categories, addTransaction } = useApp();

  const expenseCategories = categories.filter(c => c.type === "expense");
  const incomeCategories  = categories.filter(c => c.type === "income");

  const [form, setForm] = useState({
    description: "",
    amount: "",
    categoryId: expenseCategories[0]?.id ?? "",
    type: "expense" as CategoryType,
    date: new Date().toISOString().split("T")[0],
  });

  const formCategories = form.type === "expense" ? expenseCategories : incomeCategories;

  function handleTypeChange(type: CategoryType) {
    const first = (type === "expense" ? expenseCategories : incomeCategories)[0];
    setForm(prev => ({ ...prev, type, categoryId: first?.id ?? "" }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsedAmount = parseFloat(form.amount);
    if (!form.description || !form.amount || !form.categoryId || isNaN(parsedAmount) || parsedAmount <= 0) return;
    addTransaction({
      description: form.description,
      amount:      parsedAmount,
      categoryId:  form.categoryId,
      type:        form.type,
      date:        form.date,
    });
    setForm(prev => ({ ...prev, description: "", amount: "" }));
    onSubmitted?.();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
          <select
            value={form.type}
            onChange={e => handleTypeChange(e.target.value as CategoryType)}
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
  );
}
