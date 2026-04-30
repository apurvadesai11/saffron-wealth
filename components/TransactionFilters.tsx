"use client";

import { useApp } from "@/lib/app-context";

const inputClass =
  "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500";

export type TransactionTypeFilter = "all" | "income" | "expense";

export interface TransactionFilterState {
  search: string;
  type: TransactionTypeFilter;
  categoryIds: string[];   // empty = all
  dateFrom: string;        // YYYY-MM-DD or ''
  dateTo: string;
  amountMin: string;       // string keeps inputs controlled while empty
  amountMax: string;
}

export const EMPTY_FILTERS: TransactionFilterState = {
  search: "",
  type: "all",
  categoryIds: [],
  dateFrom: "",
  dateTo: "",
  amountMin: "",
  amountMax: "",
};

interface Props {
  value: TransactionFilterState;
  onChange: (next: TransactionFilterState) => void;
  onReset: () => void;
}

export default function TransactionFilters({ value, onChange, onReset }: Props) {
  const { categories } = useApp();

  const isDefault =
    value.search === "" &&
    value.type === "all" &&
    value.categoryIds.length === 0 &&
    value.dateFrom === "" &&
    value.dateTo === "" &&
    value.amountMin === "" &&
    value.amountMax === "";

  function toggleCategory(id: string) {
    const selected = value.categoryIds.includes(id);
    onChange({
      ...value,
      categoryIds: selected
        ? value.categoryIds.filter(c => c !== id)
        : [...value.categoryIds, id],
    });
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 px-6 py-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">Search & Filter</h3>
        {!isDefault && (
          <button
            onClick={onReset}
            className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors"
          >
            Reset filters
          </button>
        )}
      </div>

      {/* Row 1: search + type */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="sm:col-span-2">
          <label htmlFor="tx-filter-search" className="block text-xs font-medium text-gray-500 mb-1">Search</label>
          <input
            id="tx-filter-search"
            type="text"
            placeholder="Search by description or category…"
            value={value.search}
            onChange={e => onChange({ ...value, search: e.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="tx-filter-type" className="block text-xs font-medium text-gray-500 mb-1">Type</label>
          <select
            id="tx-filter-type"
            value={value.type}
            onChange={e => onChange({ ...value, type: e.target.value as TransactionTypeFilter })}
            className={inputClass}
          >
            <option value="all">All</option>
            <option value="income">Income</option>
            <option value="expense">Expense</option>
          </select>
        </div>
      </div>

      {/* Row 2: date range + amount range */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label htmlFor="tx-filter-date-from" className="block text-xs font-medium text-gray-500 mb-1">From</label>
          <input
            id="tx-filter-date-from"
            type="date"
            value={value.dateFrom}
            onChange={e => onChange({ ...value, dateFrom: e.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="tx-filter-date-to" className="block text-xs font-medium text-gray-500 mb-1">To</label>
          <input
            id="tx-filter-date-to"
            type="date"
            value={value.dateTo}
            onChange={e => onChange({ ...value, dateTo: e.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="tx-filter-amount-min" className="block text-xs font-medium text-gray-500 mb-1">Min ($)</label>
          <input
            id="tx-filter-amount-min"
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={value.amountMin}
            onChange={e => onChange({ ...value, amountMin: e.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="tx-filter-amount-max" className="block text-xs font-medium text-gray-500 mb-1">Max ($)</label>
          <input
            id="tx-filter-amount-max"
            type="number"
            min="0"
            step="0.01"
            placeholder="No limit"
            value={value.amountMax}
            onChange={e => onChange({ ...value, amountMax: e.target.value })}
            className={inputClass}
          />
        </div>
      </div>

      {/* Categories — colored chips, toggle multi-select */}
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-2">
          Categories {value.categoryIds.length > 0 && (
            <span className="text-gray-400">({value.categoryIds.length} selected)</span>
          )}
        </label>
        <div className="flex flex-wrap gap-1.5">
          {categories.map(cat => {
            const selected = value.categoryIds.includes(cat.id);
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => toggleCategory(cat.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-colors ${
                  selected
                    ? "bg-blue-50 border-blue-300 text-blue-700"
                    : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${cat.color}`} />
                {cat.name}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
