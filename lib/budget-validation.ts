// Hand-rolled validators + body parser for PUT /api/budgets. The route
// accepts a batch (`entries: Budget[]`) so both a single manual budget save
// and "Auto-Set All" (many categories at once) go through one upsert call.

import type { Budget, BudgetPeriod } from "./types";

export interface FieldError {
  field: string;
  message: string;
}

const VALID_PERIODS: BudgetPeriod[] = ["monthly", "quarterly", "semi-annual", "annual"];

export function validateBudgetAmount(raw: unknown): FieldError | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return { field: "amount", message: "Enter a valid amount." };
  }
  if (raw < 0) return { field: "amount", message: "Budget can't be negative." };
  return null;
}

export function validateBudgetPeriod(raw: unknown): FieldError | null {
  if (typeof raw !== "string" || !VALID_PERIODS.includes(raw as BudgetPeriod)) {
    return { field: "period", message: "Choose a valid budget period." };
  }
  return null;
}

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; fieldErrors: Record<string, string> };

export function parseSaveBudgetsBody(body: unknown): ParseResult<Budget[]> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, fieldErrors: {} };
  }
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.entries) || b.entries.length === 0) {
    return { ok: false, fieldErrors: { entries: "At least one budget entry is required." } };
  }

  const fieldErrors: Record<string, string> = {};
  const value: Budget[] = [];

  b.entries.forEach((entry, i) => {
    if (typeof entry !== "object" || entry === null) {
      fieldErrors[`${i}`] = "Invalid entry.";
      return;
    }
    const e = entry as Record<string, unknown>;

    if (typeof e.categoryId !== "string" || e.categoryId.trim().length === 0) {
      fieldErrors[`${i}.categoryId`] = "Category is required.";
    }
    const amountErr = validateBudgetAmount(e.amount);
    if (amountErr) fieldErrors[`${i}.amount`] = amountErr.message;
    const periodErr = validateBudgetPeriod(e.period);
    if (periodErr) fieldErrors[`${i}.period`] = periodErr.message;

    if (!amountErr && !periodErr && typeof e.categoryId === "string" && e.categoryId.trim().length > 0) {
      value.push({
        categoryId: e.categoryId,
        amount: e.amount as number,
        period: e.period as BudgetPeriod,
      });
    }
  });

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, value };
}
