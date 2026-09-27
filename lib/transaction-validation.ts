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

// ── GET /api/transactions query string ─────────────────────────────────────
// The Transactions page filters server-side now (it used to filter a fully
// hydrated array in the browser), so every filter arrives as a query param and
// needs the same shape checking a POST body gets. Field names match the
// TransactionFilterState keys the UI already uses, so the client can serialize
// its filter state directly.

// Mirrors MAX_PAGE_SIZE in lib/transactions.ts. Duplicated rather than
// imported because that module is server-only (it pulls in Prisma) and this
// one is imported by client components for their inline validation.
const LIMIT_MAX = 500;
const SEARCH_MAX = 200;

export interface TransactionQueryParams {
  from?: string;
  to?: string;
  type?: CategoryType;
  categoryIds?: string[];
  amountMin?: number;
  amountMax?: number;
  search?: string;
  limit?: number;
  cursor?: string;
}

// Reads an optional "YYYY-MM-DD" param, recording a field error on a bad one.
// Returns undefined both when absent and when invalid — the caller checks
// fieldErrors, not the return value, to decide whether the parse failed.
function readDateParam(
  sp: URLSearchParams,
  field: string,
  fieldErrors: Record<string, string>,
): string | undefined {
  const raw = sp.get(field);
  if (raw === null || raw.trim().length === 0) return undefined;
  const err = validateDate(raw);
  if (err) {
    fieldErrors[field] = err.message;
    return undefined;
  }
  return raw;
}

function readNumberParam(
  sp: URLSearchParams,
  field: string,
  fieldErrors: Record<string, string>,
): number | undefined {
  const raw = sp.get(field);
  if (raw === null || raw.trim().length === 0) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    fieldErrors[field] = "Enter a valid amount.";
    return undefined;
  }
  if (n < 0) {
    fieldErrors[field] = "Amount can't be negative.";
    return undefined;
  }
  if (n > AMOUNT_MAX) {
    fieldErrors[field] = "That amount is too large.";
    return undefined;
  }
  return n;
}

export function parseTransactionQueryParams(
  sp: URLSearchParams,
): ParseResult<TransactionQueryParams> {
  const fieldErrors: Record<string, string> = {};
  const value: TransactionQueryParams = {};

  const from = readDateParam(sp, "from", fieldErrors);
  const to = readDateParam(sp, "to", fieldErrors);
  if (from !== undefined) value.from = from;
  if (to !== undefined) value.to = to;
  // Lexicographic comparison is valid for "YYYY-MM-DD" and both values are
  // already format-checked by here. Caught rather than silently returning an
  // empty page, which reads as "you have no transactions" to the user.
  if (from !== undefined && to !== undefined && to < from) {
    fieldErrors.to = "End date can't be before the start date.";
  }

  // "all" is TransactionFilterState's own no-filter sentinel, so the client
  // can serialize its state without special-casing this field.
  const type = sp.get("type");
  if (type !== null && type.length > 0 && type !== "all") {
    const err = validateTransactionType(type);
    if (err) fieldErrors.type = err.message;
    else value.type = type as CategoryType;
  }

  const categoryIds = sp.get("categoryIds");
  if (categoryIds !== null) {
    const ids = categoryIds
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (ids.length > 0) value.categoryIds = ids;
  }

  const amountMin = readNumberParam(sp, "amountMin", fieldErrors);
  const amountMax = readNumberParam(sp, "amountMax", fieldErrors);
  if (amountMin !== undefined) value.amountMin = amountMin;
  if (amountMax !== undefined) value.amountMax = amountMax;
  if (amountMin !== undefined && amountMax !== undefined && amountMax < amountMin) {
    fieldErrors.amountMax = "Maximum can't be below the minimum.";
  }

  const search = sp.get("search");
  if (search !== null) {
    const trimmed = search.trim();
    if (trimmed.length > SEARCH_MAX) {
      fieldErrors.search = `Maximum ${SEARCH_MAX} characters.`;
    } else if (trimmed.length > 0) {
      value.search = trimmed;
    }
  }

  const limit = sp.get("limit");
  if (limit !== null && limit.trim().length > 0) {
    const n = Number(limit);
    if (!Number.isInteger(n) || n < 1 || n > LIMIT_MAX) {
      fieldErrors.limit = `Page size must be between 1 and ${LIMIT_MAX}.`;
    } else {
      value.limit = n;
    }
  }

  const cursor = sp.get("cursor");
  if (cursor !== null && cursor.trim().length > 0) value.cursor = cursor.trim();

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, value };
}
