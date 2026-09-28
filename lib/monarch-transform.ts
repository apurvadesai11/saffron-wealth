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

// Insurance deductible/out-of-pocket progress counters, not balances —
// importing them as accounts would inflate assets. Case-insensitive exact
// match is the caller's job; this is just the denylist. See
// docs/decisions/0005-non-account-denylist.md, which also records that these
// two literals belong in per-user data rather than here.
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

// Prefer Monarch's own stable row Id over a content hash: the fallback hash
// keys on merchant, a field users routinely rename, which would silently
// re-import a renamed row as new. The mid:/sha: prefixes keep the two
// key-spaces disjoint. See docs/decisions/0001-dedup-on-monarch-id.md.
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

// Matches `keyword` as a whole term inside `text`, both already lowercased.
//
// The previous implementation was `text.includes(keyword)`, which matched a
// keyword buried inside a longer word: "citi" matched "Citibank Checking" and
// "ira" matched "Iraq", classifying a cash asset as a credit card. That moves
// the account into the debt bucket and inverts its sign in the net-worth
// calculation — a wrong number, not a cosmetic mislabel.
//
// Inflections the trailing boundary tolerates. The keyword table is written in
// STEMS, because it was authored against `includes()`: "invest" is meant to
// catch "Investments", "house" to catch "Houses", "credit card" to catch
// "Credit Cards". A bare trailing boundary turned every one of those into a
// miss — and a miss now means `uncategorized`, i.e. dropped from net worth
// altogether, which is a worse failure than the mislabelling the boundary was
// added to prevent. Ordered longest-first so the alternation is greedy.
const KEYWORD_SUFFIXES = ["ments", "ment", "ing", "es", "s"];

// Matches `keyword` as a whole term inside `text`, both already lowercased,
// allowing the inflections above at the end.
//
// The leading lookbehind is what fixes the defect this rule exists for: "citi"
// must not match "Citibank", "ira" must not match "Iraq", "hsa" must not match
// "Kishsaver". Note that all three of those are *leading*-boundary failures —
// a keyword preceded by a word character — so the lookbehind does the real
// work and the trailing side only needs to reject a continuation that is not a
// plural or a participle ("Cashmere", "Investigation").
//
// Each lookaround is applied only if that end of the keyword is itself
// alphanumeric. A boundary assertion is meaningless against punctuation:
// "orig. $" ends in "$" and is immediately followed by a digit in the real
// data ("(Orig. $500,000.00)"), so a trailing lookahead would reject the one
// string that keyword exists to match. Internal punctuation and spaces are
// matched literally.
function matchesKeyword(text: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const before = /[a-z0-9]/.test(keyword[0]) ? "(?<![a-z0-9])" : "";
  const after = /[a-z0-9]/.test(keyword[keyword.length - 1])
    ? `(?:${KEYWORD_SUFFIXES.join("|")})?(?![a-z0-9])`
    : "";
  return new RegExp(`${before}${escaped}${after}`).test(text);
}

interface AssetTypeRule {
  keywords: string[];
  type: AccountType;
  // Keywords that disqualify this rule even when one of its own matched.
  // First-match-wins ordering can't express "a Visa-branded *debit* card is a
  // cash account" — "Visa" genuinely is a word in "Visa Debit Checking", so
  // no boundary rule rejects it and the credit-card row is checked before
  // cash. The exclusion says it directly.
  excludeKeywords?: string[];
}

// First-match-wins keyword table for the asset branch of guessAccountType,
// checked in this exact order. Order is load-bearing: 'roth 401' must beat
// '401k', 'health savings' must beat 'savings' (else the HSA reads as plain
// cash), and 'rsu'/'restricted unit' must beat 'individual' (else
// "INDIVIDUAL - Globex RSU" reads as a plain brokerage account).
//
// Only generic account-kind and card-network terms belong here. This table
// used to carry one person's own accounts — "sapphire", "bankamericard",
// "circle card", "red card", "citi" — which generalize to no second user.
// They are gone: an unrecognized account is now 'uncategorized' and surfaced
// in the import preview for its owner to classify, which is the mechanism
// those entries were standing in for. Moving the table into per-user mapping
// data is the remaining half of item 15 (15a) and needs a migration.
export const ASSET_TYPE_RULES: AssetTypeRule[] = [
  { keywords: ["roth 401k", "roth401k", "roth 401", "roth401"], type: "roth_401k" },
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
      "visa",
      "discover",
      "mastercard",
      "amex",
      "american express",
    ],
    // A deposit product sold under a card-network brand is a cash account:
    // "Discover Online Savings", "Amex High Yield Savings", "Visa Debit
    // Checking". The card rule is checked before the cash rule, and these
    // names genuinely contain a network word, so ordering cannot separate
    // them — the exclusion has to say it.
    excludeKeywords: ["debit", "checking", "savings", "banking"],
    type: "credit_card",
  },
  { keywords: ["checking", "banking", "savings", "cash"], type: "cash" },
];

// Sign first, keywords second (docs/decisions/0004-sign-before-keywords.md).
// In the real data the mortgage is
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
//
// The catch-all returns 'uncategorized', not 'cash'. Defaulting an
// unrecognized account to an asset silently inflates net worth, and for a
// net-worth tracker that is the wrong direction to fail in: an unknown account
// should be visible as unknown, not quietly counted as money you have.
// 'uncategorized' is excluded from every total (lib/account-utils.ts,
// lib/net-worth-history.ts) and reported in the import preview so its owner
// classifies it once.
export function guessAccountType(name: string, balance?: number): AccountType {
  const lower = name.toLowerCase();

  // Sign first, keywords second — see the note above.
  if (balance !== undefined && balance < 0) {
    if (
      matchesKeyword(lower, "orig. $") ||
      matchesKeyword(lower, "mortgage") ||
      matchesKeyword(lower, "loan")
    ) {
      return "loan_mortgage";
    }
    return "credit_card";
  }

  for (const rule of ASSET_TYPE_RULES) {
    if (!rule.keywords.some((keyword) => matchesKeyword(lower, keyword))) continue;
    if (rule.excludeKeywords?.some((keyword) => matchesKeyword(lower, keyword))) continue;
    return rule.type;
  }
  return "uncategorized";
}
