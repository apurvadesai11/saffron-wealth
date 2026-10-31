// Account taxonomy + net-worth math (pure logic — no DB, no transactions).
// Net worth reads ONLY from accounts: assets add, liabilities subtract. This is
// the single source of truth for the two-level type→bucket taxonomy, so the DB
// can store `type` as a plain string (enum enforced here in the app layer,
// mirroring how CategoryType / BudgetPeriod are TS unions rather than DB enums).

import type {
  Account,
  AccountBucket,
  AccountType,
  AccountBucketGroup,
  NetWorthSummary,
} from "./types";
import { formatUsd, roundToCent } from "./money";

// Display order of buckets on the Net Worth page. Assets first, debt last.
export const BUCKET_ORDER: AccountBucket[] = [
  "cash",
  "investments",
  "retirement",
  "real_estate",
  "debt",
  // Last: the page reads assets, then debt, then what needs attention.
  "uncategorized",
];

// The taxonomy, defined bucket-first so it reads top-down and can't drift out of
// sync with the type→bucket map (which is derived from it below). Also drives the
// grouped <optgroup> list in the account form.
export const ACCOUNT_TYPES_BY_BUCKET: Record<AccountBucket, AccountType[]> = {
  cash: ["cash"],
  investments: ["brokerage", "rsu", "espp", "hsa"],
  retirement: ["traditional_ira", "roth_ira", "401k", "roth_401k"],
  real_estate: ["property"],
  debt: ["credit_card", "loan_mortgage"],
  uncategorized: ["uncategorized"],
};

// Derived reverse index: type → bucket.
export const ACCOUNT_TYPE_TO_BUCKET: Record<AccountType, AccountBucket> = (() => {
  const map = {} as Record<AccountType, AccountBucket>;
  for (const bucket of BUCKET_ORDER) {
    for (const type of ACCOUNT_TYPES_BY_BUCKET[bucket]) {
      map[type] = bucket;
    }
  }
  return map;
})();

export const ACCOUNT_BUCKET_LABELS: Record<AccountBucket, string> = {
  cash: "Cash",
  investments: "Investments",
  retirement: "Retirement",
  real_estate: "Real Estate",
  debt: "Debt",
  uncategorized: "Uncategorized",
};

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  cash: "Cash",
  brokerage: "Brokerage",
  rsu: "RSU",
  espp: "ESPP",
  hsa: "HSA",
  traditional_ira: "Traditional IRA",
  roth_ira: "Roth IRA",
  "401k": "401(k)",
  roth_401k: "Roth 401(k)",
  property: "Property",
  credit_card: "Credit Card",
  loan_mortgage: "Loan/Mortgage",
  uncategorized: "Uncategorized",
};

export function isValidAccountType(value: unknown): value is AccountType {
  return typeof value === "string" && value in ACCOUNT_TYPE_TO_BUCKET;
}

export function getBucketForType(type: AccountType): AccountBucket {
  return ACCOUNT_TYPE_TO_BUCKET[type];
}

// Only debt subtracts from net worth; every other bucket is an asset.
export function isLiability(bucket: AccountBucket): boolean {
  return bucket === "debt";
}

// Account.balance is the value in its bucket's natural direction: what you
// hold for an asset, what you owe for a debt. Either can be negative — an
// overdrawn checking account, and a card carrying a statement credit — so
// display has to say which of those it is. "-$500.00" printed inside a group
// labelled Debt is ambiguous: it reads as "owes 500" or "is owed 500"
// depending on which convention the reader assumes.
export type BalanceSign = "normal" | "negative" | "owed" | "credit";

export function describeAccountBalance(
  type: AccountType,
  balance: number,
): { text: string; sign: BalanceSign } {
  const liability = isLiability(getBucketForType(type));
  if (liability) {
    return balance < 0
      ? { text: `${formatUsd(Math.abs(balance))} credit`, sign: "credit" }
      : { text: formatUsd(balance), sign: "owed" };
  }
  return balance < 0
    ? { text: formatUsd(balance), sign: "negative" }
    : { text: formatUsd(balance), sign: "normal" };
}

export function computeNetWorth(accounts: Account[]): NetWorthSummary {
  let totalAssets = 0;
  let totalLiabilities = 0;
  for (const a of accounts) {
    // An unclassified account contributes to neither total. Counting it as an
    // asset (the old catch-all) inflated net worth with a number the user had
    // never confirmed meant what the app assumed. It stays visible on the
    // page — groupAccountsByBucket gives it its own bucket — so the exclusion
    // is something the user can act on rather than a silent omission.
    if (getBucketForType(a.type) === "uncategorized") continue;
    // The owner's own exclusion, for a real account they track but don't
    // count as theirs. Still listed in its bucket, like the case above.
    if (a.hiddenFromNetWorth) continue;

    if (isLiability(getBucketForType(a.type))) {
      totalLiabilities += a.balance;
    } else {
      totalAssets += a.balance;
    }
  }
  // Rounded here, and each total independently, so this agrees with
  // computeNetWorthSeries' per-point rounding for the same data — the chart's
  // last point and the summary card are the same number. See lib/money.ts.
  return {
    totalAssets: roundToCent(totalAssets),
    totalLiabilities: roundToCent(totalLiabilities),
    netWorth: roundToCent(totalAssets - totalLiabilities),
  };
}

// The section order after dropping `draggedId` on `targetId`: the dropped
// account takes the target's slot, which reads as "insert above" when moving
// up and "insert below" when moving down. An unknown id changes nothing.
export function moveAccount(ids: string[], draggedId: string, targetId: string): string[] {
  const from = ids.indexOf(draggedId);
  const to = ids.indexOf(targetId);
  if (from === -1 || to === -1 || from === to) return ids;
  const next = ids.filter((id) => id !== draggedId);
  next.splice(to, 0, draggedId);
  return next;
}

// Groups accounts under their bucket in BUCKET_ORDER, omitting empty buckets.
export function groupAccountsByBucket(accounts: Account[]): AccountBucketGroup[] {
  return BUCKET_ORDER.flatMap((bucket) => {
    const bucketAccounts = accounts.filter((a) => getBucketForType(a.type) === bucket);
    if (bucketAccounts.length === 0) return [];
    return [
      {
        bucket,
        label: ACCOUNT_BUCKET_LABELS[bucket],
        accounts: bucketAccounts,
        // Hidden accounts stay in the list but not the total, so the bucket
        // totals still add up to the summary cards.
        bucketTotal: roundToCent(
          bucketAccounts.reduce((sum, a) => (a.hiddenFromNetWorth ? sum : sum + a.balance), 0),
        ),
      },
    ];
  });
}
