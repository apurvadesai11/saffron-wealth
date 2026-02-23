"use client";

import { useEffect, useRef, useState } from "react";
import { Budget, Category } from "@/lib/types";

interface HistoricalAverage {
  average: number;
  periodsOfData: number;
}

interface Props {
  category: Category;
  currentBudget: Budget | undefined;
  historicalAverage: HistoricalAverage | null;
  onSave: (amount: number) => void;
  onClose: () => void;
}

export default function BudgetEditModal({
  category,
  currentBudget,
  historicalAverage,
  onSave,
  onClose,
}: Props) {
  const [value, setValue] = useState(
    currentBudget !== undefined ? String(currentBudget.amount) : ""
  );
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Autofocus input when modal opens
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleUseAverage() {
    if (historicalAverage) {
      setValue(String(Math.round(historicalAverage.average)));
      setError(null);
    }
  }

  function handleSave() {
    const trimmed = value.trim();
    if (trimmed === "") {
      setError("Please enter a budget amount.");
      return;
    }
    const num = parseFloat(trimmed);
    if (isNaN(num) || num < 0) {
      setError("Budget must be $0 or more.");
      return;
    }
    onSave(Math.round(num)); // store as whole dollars
  }

  const parsedValue = parseFloat(value);
  const willBeHidden = !isNaN(parsedValue) && parsedValue === 0;

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
      aria-label="Close modal"
    >
      {/* Card — stop propagation so clicks inside don't close */}
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ──────────────────────────────────────────────── */}
        <div className="px-6 pt-6 pb-4 border-b border-gray-100">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
                {category.type === "expense" ? "Expense" : "Income"} · Monthly Budget
              </p>
              <h2 id="modal-title" className="text-xl font-bold text-gray-900">
                {category.name}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="text-gray-300 hover:text-gray-500 transition-colors text-2xl leading-none mt-0.5"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        {/* ── Spending history context (US-02) ────────────────────── */}
        <div className="px-6 py-4 border-b border-gray-100">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
            {category.type === "expense" ? "Spending" : "Income"} History
          </p>

          {historicalAverage === null ? (
            <p className="text-sm text-gray-400 italic">
              No transaction history available for this category.
            </p>
          ) : (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-800">
                  <span className="font-semibold text-gray-900">
                    ${Math.round(historicalAverage.average).toLocaleString()}
                    <span className="font-normal text-gray-500">/month</span>
                  </span>
                </p>
                {/* Limited history warning — US-02 AC: < 2 months */}
                {historicalAverage.periodsOfData < 2 ? (
                  <p className="text-xs text-amber-600 mt-0.5">
                    ⚠ Based on {historicalAverage.periodsOfData} month of data — accuracy may be limited
                  </p>
                ) : (
                  <p className="text-xs text-gray-400 mt-0.5">
                    Based on {historicalAverage.periodsOfData} months of data
                  </p>
                )}
              </div>
              <button
                onClick={handleUseAverage}
                className="text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors ml-4 shrink-0"
              >
                Use this →
              </button>
            </div>
          )}
        </div>

        {/* ── Amount input ─────────────────────────────────────────── */}
        <div className="px-6 py-5">
          <label
            htmlFor="budget-amount"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Monthly budget amount
          </label>

          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium">
              $
            </span>
            <input
              ref={inputRef}
              id="budget-amount"
              type="number"
              min="0"
              step="1"
              placeholder="0"
              value={value}
              onChange={e => {
                setValue(e.target.value);
                setError(null);
              }}
              onKeyDown={e => {
                if (e.key === "Enter") handleSave();
              }}
              className="w-full border border-gray-200 rounded-lg pl-7 pr-4 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Validation error */}
          {error && (
            <p className="text-xs text-red-500 mt-1.5">{error}</p>
          )}

          {/* $0 → hidden hint (FR-05) */}
          {willBeHidden ? (
            <p className="text-xs text-amber-600 mt-2">
              This category will be marked <span className="font-medium">Hidden from Budgets</span> and won&apos;t show a progress bar.
            </p>
          ) : (
            <p className="text-xs text-gray-400 mt-2">
              Set to $0 to hide this category from your budget view.
            </p>
          )}
        </div>

        {/* ── Actions ──────────────────────────────────────────────── */}
        <div className="px-6 pb-6 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 border border-gray-200 text-gray-700 rounded-lg py-2.5 text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex-1 bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            Save Budget
          </button>
        </div>
      </div>
    </div>
  );
}
