"use client";

import Link from "next/link";
import type { ContributionAccountOption, ContributionTarget } from "@/lib/types";

// Built by contributionAccountOptions() in lib/financial-profile-utils.ts.
export type { ContributionAccountOption };

export interface ContributionDraft {
  key: string;
  accountId: string;
  annualAmount: string;
}

// Row identity for React; see the note in IncomeStreamsEditor.
let nextKey = 0;
function rowKey(): string {
  nextKey += 1;
  return `contribution-${nextKey}`;
}

export function contributionDraftFrom(target: ContributionTarget): ContributionDraft {
  return { key: rowKey(), accountId: target.accountId, annualAmount: String(target.annualAmount) };
}

const controlClass =
  "w-full border border-line rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-accent-ring";
const errorClass = "text-xs text-danger-muted mt-1.5";

function optionLabel(a: ContributionAccountOption): string {
  const notes = [a.archived ? "archived" : null, a.eligible ? null : "no longer eligible"].filter(
    (n): n is string => n !== null,
  );
  return notes.length > 0 ? `${a.name} (${notes.join(", ")})` : a.name;
}

interface Props {
  rows: ContributionDraft[];
  accounts: ContributionAccountOption[];
  errors: Record<string, string>;
  onChange: (rows: ContributionDraft[]) => void;
}

export default function ContributionTargetsEditor({ rows, accounts, errors, onChange }: Props) {
  if (!accounts.some((a) => a.eligible) && rows.length === 0) {
    return (
      <p className="text-sm text-fg-faint">
        Add a cash, investment, or retirement account on{" "}
        <Link href="/net-worth" className="text-accent hover:text-accent-strong font-medium">
          Net Worth
        </Link>{" "}
        to set contribution targets.
      </p>
    );
  }

  function update(index: number, patch: Partial<ContributionDraft>) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  const used = new Set(rows.map((r) => r.accountId).filter((id) => id !== ""));
  // A new row needs an eligible account that neither a chosen row nor an
  // still-blank row has claimed.
  const blankRows = rows.filter((r) => r.accountId === "").length;
  const allUsed = accounts.filter((a) => a.eligible && !used.has(a.id)).length <= blankRows;

  return (
    <div className="space-y-3">
      {rows.map((row, i) => {
        const n = i + 1;
        const err = (field: string) => errors[`contributionTargets.${i}.${field}`];
        // Each row offers the eligible accounts no other row has taken, plus
        // its own — which is the only way an ineligible account appears.
        const options = accounts.filter(
          (a) => a.id === row.accountId || (a.eligible && !used.has(a.id)),
        );
        return (
          <div
            key={row.key}
            className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-start pb-3 border-b border-line-subtle sm:pb-0 sm:border-0"
          >
            <div className="sm:col-span-6">
              <select
                aria-label={`Contribution ${n} account`}
                aria-invalid={err("accountId") ? true : undefined}
                value={row.accountId}
                onChange={(e) => update(i, { accountId: e.target.value })}
                className={controlClass}
              >
                <option value="">Choose an account</option>
                {options.map((a) => (
                  <option key={a.id} value={a.id}>
                    {optionLabel(a)}
                  </option>
                ))}
              </select>
              {err("accountId") && <p className={errorClass}>{err("accountId")}</p>}
            </div>
            <div className="sm:col-span-5">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted text-sm">$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label={`Contribution ${n} annual amount`}
                  aria-invalid={err("annualAmount") ? true : undefined}
                  placeholder="Per year"
                  value={row.annualAmount}
                  onChange={(e) => update(i, { annualAmount: e.target.value })}
                  className={`${controlClass} pl-7`}
                />
              </div>
              {err("annualAmount") && <p className={errorClass}>{err("annualAmount")}</p>}
            </div>
            <div className="sm:col-span-1 flex sm:justify-end">
              <button
                type="button"
                aria-label={`Remove contribution ${n}`}
                onClick={() => onChange(rows.filter((_, j) => j !== i))}
                className="text-fg-disabled hover:text-fg-muted transition-colors text-xl leading-none px-2 py-1.5"
              >
                ×
              </button>
            </div>
          </div>
        );
      })}

      {errors.contributionTargets && <p className={errorClass}>{errors.contributionTargets}</p>}

      <button
        type="button"
        disabled={allUsed}
        onClick={() => onChange([...rows, { key: rowKey(), accountId: "", annualAmount: "" }])}
        className="text-sm font-medium text-accent hover:text-accent-strong transition-colors disabled:text-fg-faint disabled:cursor-not-allowed"
      >
        + Add contribution target
      </button>
    </div>
  );
}
