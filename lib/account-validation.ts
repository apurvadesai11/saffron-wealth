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
// Upper bound keeps values inside the Decimal(14, 2) column headroom.
const BALANCE_MAX = 1e12;

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

export function validateBalance(raw: unknown): FieldError | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return { field: "balance", message: "Enter a valid amount." };
  }
  if (raw < 0) return { field: "balance", message: "Balance can't be negative." };
  if (raw > BALANCE_MAX) return { field: "balance", message: "That amount is too large." };
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

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  if (Object.keys(value).length === 0) {
    return { ok: false, fieldErrors: { form: "No changes provided." } };
  }
  return { ok: true, value };
}
