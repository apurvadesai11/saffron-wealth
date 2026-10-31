"use client";

import { useState } from "react";
import { useApp } from "@/lib/app-context";
import type { CategoryType, Transaction } from "@/lib/types";
import AuthFormError from "@/components/auth/AuthFormError";

const TYPE_LABELS: Record<CategoryType, string> = {
  expense: "Expense",
  income: "Income",
  transfer: "Transfer",
};

const inputClass =
  "w-full border border-line rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-accent-ring";

interface Props {
  // Present to edit that transaction; absent to add a new one.
  transaction?: Transaction;
  onSubmitted?: () => void;
}

export default function TransactionForm({ transaction, onSubmitted }: Props) {
  const { categories, addTransaction, updateTransaction } = useApp();
  const editing = transaction !== undefined;
  // The add form sits inline on the same page an edit dialog opens over, so
  // the two need distinct ids for their labels to resolve.
  const idPrefix = editing ? "tx-edit" : "tx-form";

  const categoriesOf = (type: CategoryType) => categories.filter(c => c.type === type);
  // Transfers only arrive by import. Editing offers the type so an imported
  // row can be moved into or out of it; adding one by hand still doesn't.
  const typeOptions: CategoryType[] =
    editing && categoriesOf("transfer").length > 0
      ? ["expense", "income", "transfer"]
      : ["expense", "income"];

  const [form, setForm] = useState({
    description: transaction?.description ?? "",
    amount: transaction ? String(transaction.amount) : "",
    categoryId: transaction?.categoryId ?? categoriesOf("expense")[0]?.id ?? "",
    type: transaction?.type ?? ("expense" as CategoryType),
    date: transaction?.date ?? new Date().toISOString().split("T")[0],
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formCategories = categoriesOf(form.type);
  // A row filed under a category that's since left the list (archived) keeps
  // it as an option. Without one, the select would show the first category
  // while the form submitted this one.
  const currentIsMissing =
    form.categoryId !== "" && !formCategories.some(c => c.id === form.categoryId);

  function handleTypeChange(type: CategoryType) {
    const first = categoriesOf(type)[0];
    setForm(prev => ({ ...prev, type, categoryId: first?.id ?? "" }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsedAmount = parseFloat(form.amount);
    if (!form.description || !form.amount || !form.categoryId || isNaN(parsedAmount) || parsedAmount <= 0) return;
    setError(null);
    setSubmitting(true);
    const fields = {
      description: form.description,
      amount:      parsedAmount,
      categoryId:  form.categoryId,
      type:        form.type,
      date:        form.date,
    };
    try {
      if (transaction) {
        await updateTransaction(transaction.id, fields);
      } else {
        await addTransaction(fields);
        setForm(prev => ({ ...prev, description: "", amount: "" }));
      }
      onSubmitted?.();
    } catch {
      setError("Couldn't save the transaction. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor={`${idPrefix}-type`} className="block text-sm font-medium text-fg-secondary mb-1">Type</label>
          <select
            id={`${idPrefix}-type`}
            value={form.type}
            onChange={e => handleTypeChange(e.target.value as CategoryType)}
            className={inputClass}
          >
            {typeOptions.map(type => (
              <option key={type} value={type}>{TYPE_LABELS[type]}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${idPrefix}-category`} className="block text-sm font-medium text-fg-secondary mb-1">Category</label>
          <select
            id={`${idPrefix}-category`}
            value={form.categoryId}
            onChange={e => setForm(prev => ({ ...prev, categoryId: e.target.value }))}
            className={inputClass}
          >
            {currentIsMissing && (
              <option value={form.categoryId}>
                {categories.find(c => c.id === form.categoryId)?.name ?? "Current category"}
              </option>
            )}
            {formCategories.map(cat => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor={`${idPrefix}-description`} className="block text-sm font-medium text-fg-secondary mb-1">Description</label>
          <input
            id={`${idPrefix}-description`}
            type="text"
            placeholder="e.g. Netflix subscription"
            value={form.description}
            onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
            className={inputClass}
            required
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-amount`} className="block text-sm font-medium text-fg-secondary mb-1">Amount ($)</label>
          <input
            id={`${idPrefix}-amount`}
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
        <label htmlFor={`${idPrefix}-date`} className="block text-sm font-medium text-fg-secondary mb-1">Date</label>
        <input
          id={`${idPrefix}-date`}
          type="date"
          value={form.date}
          onChange={e => setForm(prev => ({ ...prev, date: e.target.value }))}
          className={inputClass}
        />
      </div>
      <AuthFormError message={error} />
      <button
        type="submit"
        disabled={submitting}
        className="w-full bg-accent-solid text-on-solid rounded-lg py-2 px-4 text-sm font-medium hover:bg-accent-solid-hover transition-colors disabled:opacity-60"
      >
        {submitting ? "Saving…" : editing ? "Save Changes" : "Save Transaction"}
      </button>
    </form>
  );
}
