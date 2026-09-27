// Hand-rolled validators + body parser for POST /api/transactions (no Zod —
// matches the house style in lib/account-validation.ts). Existence/ownership
// of categoryId/accountId is a DB concern and is checked in lib/transactions.ts,
// not here — this module only validates shape.

import type { CategoryType } from "./types";

export interface FieldError {
  field: string;
  message: string;
}

const DESCRIPTION_MAX = 200;
// Upper bound keeps values inside the Decimal(14, 2) column headroom.
const AMOUNT_MAX = 1e12;
const VALID_TYPES: CategoryType[] = ["income", "expense", "transfer"];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function validateDescription(raw: string): FieldError | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { field: "description", message: "Description is required." };
  if (trimmed.length > DESCRIPTION_MAX) {
    return { field: "description", message: `Maximum ${DESCRIPTION_MAX} characters.` };
  }
  return null;
}

export function validateAmount(raw: unknown): FieldError | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return { field: "amount", message: "Enter a valid amount." };
  }
  if (raw < 0) return { field: "amount", message: "Amount can't be negative." };
  if (raw > AMOUNT_MAX) return { field: "amount", message: "That amount is too large." };
  return null;
}

export function validateTransactionType(raw: unknown): FieldError | null {
  if (typeof raw !== "string" || !VALID_TYPES.includes(raw as CategoryType)) {
    return { field: "type", message: "Choose a valid transaction type." };
  }
  return null;
}

export function validateDate(raw: unknown): FieldError | null {
  if (typeof raw !== "string" || !DATE_PATTERN.test(raw)) {
    return { field: "date", message: "Enter a date in YYYY-MM-DD format." };
  }
  const [year, month, day] = raw.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
    return { field: "date", message: "Enter a valid date." };
  }
  return null;
}

export interface CreateTransactionInput {
  description: string;
  amount: number;
  categoryId: string;
  type: CategoryType;
  date: string;
  accountId: string | null;
}

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; fieldErrors: Record<string, string> };

export function parseCreateTransactionBody(body: unknown): ParseResult<CreateTransactionInput> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, fieldErrors: {} };
  }
  const b = body as Record<string, unknown>;
  const fieldErrors: Record<string, string> = {};

  const descErr = validateDescription(typeof b.description === "string" ? b.description : "");
  if (descErr) fieldErrors.description = descErr.message;

  const amountErr = validateAmount(b.amount);
  if (amountErr) fieldErrors.amount = amountErr.message;

  if (typeof b.categoryId !== "string" || b.categoryId.trim().length === 0) {
    fieldErrors.categoryId = "Category is required.";
  }

  const typeErr = validateTransactionType(b.type);
  if (typeErr) fieldErrors.type = typeErr.message;

  const dateErr = validateDate(b.date);
  if (dateErr) fieldErrors.date = dateErr.message;

  let accountId: string | null = null;
  if (b.accountId !== undefined && b.accountId !== null) {
    if (typeof b.accountId !== "string" || b.accountId.trim().length === 0) {
      fieldErrors.accountId = "Invalid account.";
    } else {
      accountId = b.accountId;
    }
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  return {
    ok: true,
    value: {
      description: (b.description as string).trim(),
      amount: b.amount as number,
      categoryId: b.categoryId as string,
      type: b.type as CategoryType,
      date: b.date as string,
      accountId,
    },
  };
}
