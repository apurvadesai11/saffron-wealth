"use client";

import { useApp } from "@/lib/app-context";
import { validateDate } from "@/lib/transaction-validation";
import CategoryMultiSelect from "./CategoryMultiSelect";

const inputClass =
  "w-full border border-line rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-accent-ring";

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

// The URL form of a filter, under the names GET /api/transactions reads. The
// page's API query is built from it, and so are links into the page (Monthly
// Review's cashflow rows), which the page reads back on load. Empty values
// are left out, and "all" is the no-type-filter sentinel.
export function filtersToSearchParams(f: TransactionFilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (f.search.trim()) params.set("search", f.search.trim());
  if (f.type !== "all") params.set("type", f.type);
  if (f.categoryIds.length) params.set("categoryIds", f.categoryIds.join(","));
  if (f.dateFrom) params.set("from", f.dateFrom);
  if (f.dateTo) params.set("to", f.dateTo);
  if (f.amountMin) params.set("amountMin", f.amountMin);
  if (f.amountMax) params.set("amountMax", f.amountMax);
  return params;
}

// A value the API would reject is dropped rather than carried into a field: a
// stale or hand-edited link should show the list, not a filter error.
export function filtersFromSearchParams(sp: URLSearchParams): TransactionFilterState {
  const date = (name: string) => {
    const raw = sp.get(name) ?? "";
    return raw && validateDate(raw) === null ? raw : "";
  };
  const amount = (name: string) => {
    const raw = sp.get(name) ?? "";
    const n = Number(raw);
    return raw.trim() && Number.isFinite(n) && n >= 0 ? raw : "";
  };
  const type = sp.get("type");
  return {
    search: sp.get("search") ?? "",
    type: type === "income" || type === "expense" ? type : "all",
    categoryIds: (sp.get("categoryIds") ?? "")
      .split(",")
      .map(id => id.trim())
      .filter(id => id.length > 0),
    dateFrom: date("from"),
    dateTo: date("to"),
    amountMin: amount("amountMin"),
    amountMax: amount("amountMax"),
  };
}

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

  return (
    <div className="bg-surface rounded-xl shadow-sm border border-line-subtle px-6 py-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-fg-secondary">Search & Filter</h3>
        {!isDefault && (
          <button
            onClick={onReset}
            className="text-xs font-medium text-accent hover:text-accent-strong transition-colors"
          >
            Reset filters
          </button>
        )}
      </div>

      {/* Row 1: search + type + categories */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div className="sm:col-span-2">
          <label htmlFor="tx-filter-search" className="block text-xs font-medium text-fg-muted mb-1">Search</label>
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
          <label htmlFor="tx-filter-type" className="block text-xs font-medium text-fg-muted mb-1">Type</label>
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
        <div>
          <label htmlFor="tx-filter-categories" className="block text-xs font-medium text-fg-muted mb-1">Categories</label>
          <CategoryMultiSelect
            id="tx-filter-categories"
            categories={categories}
            selectedIds={value.categoryIds}
            onChange={categoryIds => onChange({ ...value, categoryIds })}
          />
        </div>
      </div>

      {/* Row 2: date range + amount range */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label htmlFor="tx-filter-date-from" className="block text-xs font-medium text-fg-muted mb-1">From</label>
          <input
            id="tx-filter-date-from"
            type="date"
            value={value.dateFrom}
            onChange={e => onChange({ ...value, dateFrom: e.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="tx-filter-date-to" className="block text-xs font-medium text-fg-muted mb-1">To</label>
          <input
            id="tx-filter-date-to"
            type="date"
            value={value.dateTo}
            onChange={e => onChange({ ...value, dateTo: e.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="tx-filter-amount-min" className="block text-xs font-medium text-fg-muted mb-1">Min ($)</label>
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
          <label htmlFor="tx-filter-amount-max" className="block text-xs font-medium text-fg-muted mb-1">Max ($)</label>
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
    </div>
  );
}
