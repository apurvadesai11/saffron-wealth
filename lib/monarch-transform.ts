// Pure row -> domain transforms shared by both Monarch imports (Phase 2b
// transaction import, Phase 3 balance-history import). No DB, no fetch, no
// React — lib/csv.ts owns parsing; this module only turns already-parsed
// field values into the app's domain shapes so it stays trivially unit
// testable and reusable by both API routes.

import { createHash } from "node:crypto";
import type { AccountType, CategoryType } from "./types";

// Category-type sign-inference is deliberately skipped for these three: a
// card payment or balance adjustment is not income/expense, it's money
// moving between accounts the user already owns. Routing by name (not sign)
// keeps that true regardless of which direction the row happens to post.
// Named constant so a future fourth transfer-like category is a data change,
// not a code change.
export const TRANSFER_LIKE_CATEGORIES = ["transfer", "balance adjustments", "credit card payment"];

// Ruling 5: these two Monarch rows are insurance deductible/out-of-pocket
// progress counters, not account balances — importing them as accounts would
// inflate assets. Case-insensitive exact match is the caller's job; this is
// just the denylist.
export const NON_ACCOUNT_NAMES = [
  "Individual innetwork medical deductible",
  "Individual innetwork medical outofpocket",
];

function isTransferLike(categoryName: string): boolean {
  const normalized = categoryName.trim().toLowerCase();
  return TRANSFER_LIKE_CATEGORIES.includes(normalized);
}

// Defensive strip: the transaction CSV's Amount column is a plain signed
// decimal on every real row (no $, no commas, no parens), but other Monarch
// exports (and hand-edited re-uploads) may format it like a display value.
// Cheap to handle, so handle it rather than trust the happy path.
export function parseAmount(raw: string): number {
  const trimmed = raw.trim();
  const isParenNegative = trimmed.startsWith("(") && trimmed.endsWith(")");
  const inner = isParenNegative ? trimmed.slice(1, -1) : trimmed;
  const stripped = inner.replace(/\$/g, "").replace(/,/g, "").trim();

  if (stripped.length === 0 || !Number.isFinite(Number(stripped))) {
    throw new Error(`Unparseable amount: "${raw}"`);
  }

  const value = Number(stripped);
  return isParenNegative ? -Math.abs(value) : value;
}

// Transfer-like category names win over the row's sign (Decision 1): a
// credit card payment can post as either sign in different exports, but it
// is never income or expense either way.
export function classifyTransaction(
  categoryName: string,
  amount: number,
): { type: CategoryType; amount: number } {
  if (isTransferLike(categoryName)) {
    return { type: "transfer", amount: Math.abs(amount) };
  }
  return { type: amount < 0 ? "expense" : "income", amount: Math.abs(amount) };
}

// Used when creating a Category that doesn't exist yet, so it needs a type
// before any individual transaction's sign is relevant. Transfer-like names
// short-circuit without looking at amounts at all, matching classifyTransaction's
// per-row rule; otherwise the batch's dominant sign wins, defaulting to
// 'expense' on a tie or an empty batch (new categories are far more likely to
// be expenses than income).
export function inferCategoryType(categoryName: string, amountsForThatCategory: number[]): CategoryType {
  if (isTransferLike(categoryName)) return "transfer";

  let negativeCount = 0;
  let positiveCount = 0;
  for (const amount of amountsForThatCategory) {
    if (amount < 0) negativeCount++;
    else if (amount > 0) positiveCount++;
  }
  return positiveCount > negativeCount ? "income" : "expense";
}

// Ruling 1: prefer Monarch's own stable row Id over a content hash, because
// the fallback hash keys on merchant — a field users routinely rename in
// Monarch's UI, which would silently re-import a renamed row as new. The
// mid:/sha: prefixes keep the two key-spaces disjoint and self-document which
// path produced a given hash.
export function buildExternalHash(input: {
  id?: string | null;
  date: string;
  amount: number;
  account: string;
  merchant?: string | null;
  originalStatement?: string | null;
}): string {
  const { id, date, amount, account, merchant, originalStatement } = input;
  if (typeof id === "string" && id.trim().length > 0) {
    return `mid:${id}`;
  }
  const composite = [date, Math.abs(amount).toString(), account, merchant ?? "", originalStatement ?? ""].join(
    "|",
  );
  return `sha:${createHash("sha256").update(composite).digest("hex")}`;
}

// First-match-wins keyword table for the asset branch of guessAccountType,
// checked in this exact order. Order is load-bearing: 'roth 401' must beat
// '401k', 'health savings' must beat 'savings' (else the HSA reads as plain
// cash), and 'rsu'/'restricted unit' must beat 'individual' (else
// "INDIVIDUAL - Globex RSU" reads as a plain brokerage account).
const ASSET_TYPE_RULES: { keywords: string[]; type: AccountType }[] = [
  { keywords: ["roth 401", "roth401"], type: "roth_401k" },
  { keywords: ["401(k)", "401k"], type: "401k" },
  { keywords: ["roth ira"], type: "roth_ira" },
  { keywords: ["traditional ira"], type: "traditional_ira" },
  { keywords: ["ira"], type: "traditional_ira" },
  { keywords: ["hsa", "health savings"], type: "hsa" },
  { keywords: ["restricted unit", "rsu"], type: "rsu" },
  { keywords: ["stock plan", "stock purchase", "espp"], type: "espp" },
  { keywords: ["brokerage", "individual", "invest"], type: "brokerage" },
  { keywords: ["property", "real estate", "house"], type: "property" },
  {
    keywords: [
      "credit card",
      "sapphire",
      "visa",
      "discover",
      "bankamericard",
      "mastercard",
      "amex",
      "american express",
      "citi",
      "circle card",
      "red card",
    ],
    type: "credit_card",
  },
  { keywords: ["checking", "banking", "savings", "cash"], type: "cash" },
];

// Ruling 4: sign first, keywords second. In the real data the mortgage is
// named "1200 MAPLE STREET (Orig. $500,000.00) (...1111)" while the
// property it secures is named "1200 maple" — no keyword can separate
// those two, but the balance sign always can. "Orig. $" is Monarch's own
// loan-origination marker, which is why it's a liability keyword here rather
// than a dollar-amount artifact for parseAmount to strip.
//
// When `balance` is omitted (transaction-only accounts have no balance to
// sign-check), the asset branch runs unconditionally and rule 11 below
// produces 'credit_card' for a credit-card-named account on its own — no
// separate branch needed for that case.
export function guessAccountType(name: string, balance?: number): AccountType {
  const lower = name.toLowerCase();

  if (balance !== undefined && balance < 0) {
    if (lower.includes("orig. $") || lower.includes("mortgage") || lower.includes("loan")) {
      return "loan_mortgage";
    }
    return "credit_card";
  }

  for (const rule of ASSET_TYPE_RULES) {
    if (rule.keywords.some((keyword) => lower.includes(keyword))) {
      return rule.type;
    }
  }
  return "cash";
}
