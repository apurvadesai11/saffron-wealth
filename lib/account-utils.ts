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

// Display order of buckets on the Net Worth page. Assets first, debt last.
export const BUCKET_ORDER: AccountBucket[] = [
  "cash",
  "investments",
  "retirement",
  "real_estate",
  "debt",
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

export function computeNetWorth(accounts: Account[]): NetWorthSummary {
  let totalAssets = 0;
  let totalLiabilities = 0;
  for (const a of accounts) {
    if (isLiability(getBucketForType(a.type))) {
      totalLiabilities += a.balance;
    } else {
      totalAssets += a.balance;
    }
  }
  return { totalAssets, totalLiabilities, netWorth: totalAssets - totalLiabilities };
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
        bucketTotal: bucketAccounts.reduce((sum, a) => sum + a.balance, 0),
      },
    ];
  });
}
