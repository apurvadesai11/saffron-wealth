"use client";

import type { IncomeKind, IncomeStream, PayFrequency } from "@/lib/types";
import {
  DEFAULT_FREQUENCY_BY_KIND,
  INCOME_KINDS,
  INCOME_KIND_LABELS,
  PAY_FREQUENCIES,
  PAY_FREQUENCY_LABELS,
  totalAnnualIncome,
} from "@/lib/financial-profile-utils";
import { parseNumberInput } from "@/lib/financial-profile-validation";

// A row as the form holds it: text exactly as typed, so a half-typed "90,0"
// survives a re-render. FinancialProfileClient converts rows to IncomeStream
// when it builds the request body.
export interface IncomeDraft {
  key: string;
  kind: IncomeKind;
  label: string;
  annualAmount: string;
  frequency: PayFrequency | "";
}

// Row identity for React. Never rendered, so the server and the browser
// counting from different places doesn't matter.
let nextKey = 0;
function rowKey(): string {
  nextKey += 1;
  return `income-${nextKey}`;
}

export function newIncomeDraft(kind: IncomeKind = "salary"): IncomeDraft {
  return { key: rowKey(), kind, label: "", annualAmount: "", frequency: DEFAULT_FREQUENCY_BY_KIND[kind] ?? "" };
}

export function incomeDraftFrom(stream: IncomeStream): IncomeDraft {
  return {
    key: rowKey(),
    kind: stream.kind,
    label: stream.label ?? "",
    annualAmount: String(stream.annualAmount),
    frequency: stream.frequency ?? "",
  };
}

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

const controlClass =
  "w-full border border-line rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-accent-ring";
const errorClass = "text-xs text-danger-muted mt-1.5";

interface Props {
  rows: IncomeDraft[];
  errors: Record<string, string>;
  onChange: (rows: IncomeDraft[]) => void;
}

export default function IncomeStreamsEditor({ rows, errors, onChange }: Props) {
  function update(index: number, patch: Partial<IncomeDraft>) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function changeKind(index: number, kind: IncomeKind) {
    const row = rows[index];
    // Carry the frequency along only while it is still the old kind's default
    // — a frequency the user chose is theirs.
    const untouched = row.frequency === "" || row.frequency === DEFAULT_FREQUENCY_BY_KIND[row.kind];
    update(index, untouched ? { kind, frequency: DEFAULT_FREQUENCY_BY_KIND[kind] ?? "" } : { kind });
  }

  const total = totalAnnualIncome(
    rows
      .map((row) => parseNumberInput(row.annualAmount))
      .filter((n): n is number => n !== undefined && Number.isFinite(n) && n > 0)
      .map((annualAmount) => ({ annualAmount })),
  );

  return (
    <div className="space-y-3">
      {rows.length === 0 && (
        <p className="text-sm text-fg-faint">
          No income yet. Add each source separately (salary, bonus, RSUs, rental) so later
          planning can tell earned income from the rest.
        </p>
      )}

      {rows.map((row, i) => {
        const n = i + 1;
        const err = (field: string) => errors[`incomeStreams.${i}.${field}`];
        return (
          <div key={row.key} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-start">
            <div className="sm:col-span-3">
              <select
                aria-label={`Income ${n} type`}
                aria-invalid={err("kind") ? true : undefined}
                value={row.kind}
                onChange={(e) => changeKind(i, e.target.value as IncomeKind)}
                className={controlClass}
              >
                {INCOME_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {INCOME_KIND_LABELS[kind]}
                  </option>
                ))}
              </select>
              {err("kind") && <p className={errorClass}>{err("kind")}</p>}
            </div>
            <div className="sm:col-span-3">
              <input
                type="text"
                aria-label={`Income ${n} label`}
                aria-invalid={err("label") ? true : undefined}
                placeholder="Label (optional)"
                value={row.label}
                onChange={(e) => update(i, { label: e.target.value })}
                className={controlClass}
              />
              {err("label") && <p className={errorClass}>{err("label")}</p>}
            </div>
            <div className="sm:col-span-3">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted text-sm">$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label={`Income ${n} annual amount`}
                  aria-invalid={err("annualAmount") ? true : undefined}
                  placeholder="Per year, gross"
                  value={row.annualAmount}
                  onChange={(e) => update(i, { annualAmount: e.target.value })}
                  className={`${controlClass} pl-7`}
                />
              </div>
              {err("annualAmount") && <p className={errorClass}>{err("annualAmount")}</p>}
            </div>
            <div className="sm:col-span-2">
              <select
                aria-label={`Income ${n} frequency`}
                aria-invalid={err("frequency") ? true : undefined}
                value={row.frequency}
                onChange={(e) => update(i, { frequency: e.target.value as PayFrequency | "" })}
                className={controlClass}
              >
                <option value="">Not specified</option>
                {PAY_FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {PAY_FREQUENCY_LABELS[f]}
                  </option>
                ))}
              </select>
              {err("frequency") && <p className={errorClass}>{err("frequency")}</p>}
            </div>
            <div className="sm:col-span-1 flex sm:justify-end">
              <button
                type="button"
                aria-label={`Remove income ${n}`}
                onClick={() => onChange(rows.filter((_, j) => j !== i))}
                className="text-fg-disabled hover:text-fg-muted transition-colors text-xl leading-none px-2 py-1.5"
              >
                ×
              </button>
            </div>
          </div>
        );
      })}

      {errors.incomeStreams && <p className={errorClass}>{errors.incomeStreams}</p>}

      <div className="flex items-center justify-between pt-1">
        <button
          type="button"
          onClick={() => onChange([...rows, newIncomeDraft()])}
          className="text-sm font-medium text-accent hover:text-accent-strong transition-colors"
        >
          + Add income
        </button>
        <p className="text-sm text-fg-muted">
          Total annual income{" "}
          <span data-testid="income-total" className="font-semibold text-fg">
            {currency.format(total)}
          </span>
        </p>
      </div>
    </div>
  );
}
