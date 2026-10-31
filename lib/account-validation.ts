// Hand-rolled validators + body parsers for the accounts API (no Zod — matches
// the house style in lib/auth/validation.ts). Parsers return either a normalized
// value or a field-keyed error map that the route surfaces as VALIDATION_FAILED.

import type { AccountInput, AccountPatch, AccountType } from "./types";
import { isValidAccountType } from "./account-utils";

export interface FieldError {
  field: string;
  message: string;
}

const NAME_MAX = 80;
const INSTITUTION_MAX = 80;
// The largest magnitude the Decimal(14, 2) column can hold. See the note on
// AMOUNT_MAX in lib/transaction-validation.ts: this was 1e12 with a strict
// comparison, so exactly 1e12 passed validation and failed at the database as
// a 500.
const BALANCE_MAX = 999_999_999_999.99;

export function validateAccountName(raw: string): FieldError | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { field: "name", message: "Account name is required." };
  if (trimmed.length > NAME_MAX) return { field: "name", message: `Maximum ${NAME_MAX} characters.` };
  return null;
}

export function validateInstitution(raw: string): FieldError | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null; // optional field
  if (trimmed.length > INSTITUTION_MAX) {
    return { field: "institution", message: `Maximum ${INSTITUTION_MAX} characters.` };
  }
  return null;
}

// Negative is allowed in both directions: an asset can be overdrawn and a
// debt balance (stored as the amount owed) goes negative when the account
// carries a statement credit. Rejecting them here is what forced the balance
// import to clamp, and a clamp on the asset side silently overstates net
// worth. Only the column's magnitude limit is enforced.
export function validateBalance(raw: unknown): FieldError | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return { field: "balance", message: "Enter a valid amount." };
  }
  if (Math.abs(raw) > BALANCE_MAX) {
    return { field: "balance", message: "That amount is too large." };
  }
  return null;
}

export function validateAccountType(raw: unknown): FieldError | null {
  if (!isValidAccountType(raw)) return { field: "type", message: "Choose an account type." };
  return null;
}

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; fieldErrors: Record<string, string> };

// Reads an optional institution field into a trimmed string or null, recording
// a field error into `fieldErrors` on a bad type. Shared by create + update.
function readInstitution(
  b: Record<string, unknown>,
  fieldErrors: Record<string, string>,
): string | null {
  if (b.institution === undefined || b.institution === null) return null;
  if (typeof b.institution !== "string") {
    fieldErrors.institution = "Invalid institution.";
    return null;
  }
  const err = validateInstitution(b.institution);
  if (err) {
    fieldErrors.institution = err.message;
    return null;
  }
  const trimmed = b.institution.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function parseCreateAccountBody(body: unknown): ParseResult<AccountInput> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, fieldErrors: {} };
  }
  const b = body as Record<string, unknown>;
  const fieldErrors: Record<string, string> = {};

  const nameErr = validateAccountName(typeof b.name === "string" ? b.name : "");
  if (nameErr) fieldErrors.name = nameErr.message;

  const typeErr = validateAccountType(b.type);
  if (typeErr) fieldErrors.type = typeErr.message;

  const balanceErr = validateBalance(b.balance);
  if (balanceErr) fieldErrors.balance = balanceErr.message;

  const institution = readInstitution(b, fieldErrors);

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  return {
    ok: true,
    value: {
      name: (b.name as string).trim(),
      type: b.type as AccountType,
      institution,
      balance: b.balance as number,
    },
  };
}

// Far past any real account count; the bound is there so the update loop in
// reorderAccounts is never handed an arbitrarily long list.
const REORDER_MAX = 500;

// PUT /api/accounts/order: one section's account ids, in their new order.
export function parseReorderAccountsBody(body: unknown): ParseResult<{ accountIds: string[] }> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, fieldErrors: {} };
  }
  const ids = (body as Record<string, unknown>).accountIds;
  if (!Array.isArray(ids) || ids.length === 0) {
    return { ok: false, fieldErrors: { accountIds: "List the accounts in their new order." } };
  }
  if (ids.length > REORDER_MAX) {
    return { ok: false, fieldErrors: { accountIds: `At most ${REORDER_MAX} accounts can be reordered at once.` } };
  }
  if (!ids.every((id) => typeof id === "string" && id.length > 0)) {
    return { ok: false, fieldErrors: { accountIds: "Every account id must be a non-empty string." } };
  }
  // A repeated id has no single position to save.
  if (new Set(ids).size !== ids.length) {
    return { ok: false, fieldErrors: { accountIds: "An account can appear only once." } };
  }
  return { ok: true, value: { accountIds: ids as string[] } };
}

export function parseUpdateAccountBody(body: unknown): ParseResult<AccountPatch> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, fieldErrors: {} };
  }
  const b = body as Record<string, unknown>;
  const fieldErrors: Record<string, string> = {};
  const value: AccountPatch = {};

  if ("name" in b) {
    const err = validateAccountName(typeof b.name === "string" ? b.name : "");
    if (err) fieldErrors.name = err.message;
    else value.name = (b.name as string).trim();
  }
  if ("type" in b) {
    const err = validateAccountType(b.type);
    if (err) fieldErrors.type = err.message;
    else value.type = b.type as AccountType;
  }
  if ("balance" in b) {
    const err = validateBalance(b.balance);
    if (err) fieldErrors.balance = err.message;
    else value.balance = b.balance as number;
  }
  if ("institution" in b) {
    value.institution = readInstitution(b, fieldErrors);
  }
  // Restore-only: archivedAt may be PATCHed to exactly `null` (clear it) and
  // nothing else — there is no PATCH-based way to set it, so any other
  // value is rejected rather than silently ignored. Archiving stays
  // DELETE-only (archiveAccount).
  if ("archivedAt" in b) {
    if (b.archivedAt !== null) {
      fieldErrors.archivedAt = "archivedAt can only be cleared (set to null) to restore an account.";
    } else {
      value.archivedAt = null;
    }
  }
  // Strictly boolean: the string "false" is truthy, and coercing it would
  // hide the account the caller asked to show.
  if ("hiddenFromNetWorth" in b) {
    if (typeof b.hiddenFromNetWorth !== "boolean") {
      fieldErrors.hiddenFromNetWorth = "hiddenFromNetWorth must be true or false.";
    } else {
      value.hiddenFromNetWorth = b.hiddenFromNetWorth;
    }
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  if (Object.keys(value).length === 0) {
    return { ok: false, fieldErrors: { form: "No changes provided." } };
  }
  return { ok: true, value };
}
