import { describe, it, expect } from "vitest";
import {
  ACCOUNT_TYPE_TO_BUCKET,
  ACCOUNT_TYPES_BY_BUCKET,
  BUCKET_ORDER,
  ACCOUNT_BUCKET_LABELS,
  ACCOUNT_TYPE_LABELS,
  isValidAccountType,
  getBucketForType,
  isLiability,
  computeNetWorth,
  groupAccountsByBucket,
} from "./account-utils";
import type { Account, AccountType } from "./types";

const ALL_TYPES: AccountType[] = [
  "cash",
  "brokerage", "rsu", "espp", "hsa",
  "traditional_ira", "roth_ira", "401k", "roth_401k",
  "property",
  "credit_card", "loan_mortgage",
];

// Minimal Account fixture — only the fields the pure helpers read matter.
function acct(type: AccountType, balance: number, over: Partial<Account> = {}): Account {
  return {
    id: `${type}-${balance}`,
    name: type,
    type,
    institution: null,
    balance,
    balanceAsOf: "2026-07-17T00:00:00.000Z",
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
    ...over,
  };
}

describe("taxonomy maps", () => {
  it("maps every AccountType to a bucket", () => {
    for (const t of ALL_TYPES) {
      expect(ACCOUNT_TYPE_TO_BUCKET[t]).toBeDefined();
    }
    expect(Object.keys(ACCOUNT_TYPE_TO_BUCKET).sort()).toEqual([...ALL_TYPES].sort());
  });

  it("ACCOUNT_TYPES_BY_BUCKET covers every type exactly once and agrees with the type→bucket map", () => {
    const flattened = BUCKET_ORDER.flatMap((b) => ACCOUNT_TYPES_BY_BUCKET[b]);
    expect(flattened.sort()).toEqual([...ALL_TYPES].sort());
    for (const b of BUCKET_ORDER) {
      for (const t of ACCOUNT_TYPES_BY_BUCKET[b]) {
        expect(ACCOUNT_TYPE_TO_BUCKET[t]).toBe(b);
      }
    }
  });

  it("BUCKET_ORDER contains all five buckets in display order", () => {
    expect(BUCKET_ORDER).toEqual(["cash", "investments", "retirement", "real_estate", "debt"]);
  });

  it("has a human label for every bucket and type", () => {
    for (const b of BUCKET_ORDER) expect(ACCOUNT_BUCKET_LABELS[b]).toBeTruthy();
    for (const t of ALL_TYPES) expect(ACCOUNT_TYPE_LABELS[t]).toBeTruthy();
    expect(ACCOUNT_BUCKET_LABELS.real_estate).toBe("Real Estate");
    expect(ACCOUNT_TYPE_LABELS["401k"]).toBe("401(k)");
    expect(ACCOUNT_TYPE_LABELS.traditional_ira).toBe("Traditional IRA");
  });
});

describe("isValidAccountType", () => {
  it("accepts known types", () => {
    for (const t of ALL_TYPES) expect(isValidAccountType(t)).toBe(true);
  });
  it("rejects unknown / non-string values", () => {
    expect(isValidAccountType("savings")).toBe(false);
    expect(isValidAccountType("")).toBe(false);
    expect(isValidAccountType(null)).toBe(false);
    expect(isValidAccountType(42)).toBe(false);
    expect(isValidAccountType(undefined)).toBe(false);
  });
});

describe("getBucketForType / isLiability", () => {
  it("resolves a type to its bucket", () => {
    expect(getBucketForType("brokerage")).toBe("investments");
    expect(getBucketForType("401k")).toBe("retirement");
    expect(getBucketForType("credit_card")).toBe("debt");
  });
  it("treats only the debt bucket as a liability", () => {
    expect(isLiability("debt")).toBe(true);
    expect(isLiability("cash")).toBe(false);
    expect(isLiability("investments")).toBe(false);
    expect(isLiability("retirement")).toBe(false);
    expect(isLiability("real_estate")).toBe(false);
  });
});

describe("computeNetWorth", () => {
  it("returns all zeros for no accounts", () => {
    expect(computeNetWorth([])).toEqual({ totalAssets: 0, totalLiabilities: 0, netWorth: 0 });
  });

  it("adds asset buckets and subtracts the debt bucket", () => {
    const accounts = [
      acct("cash", 5000),
      acct("brokerage", 10000),
      acct("401k", 20000),
      acct("property", 400000),
      acct("credit_card", 2000),   // liability, stored positive
      acct("loan_mortgage", 300000), // liability, stored positive
    ];
    const { totalAssets, totalLiabilities, netWorth } = computeNetWorth(accounts);
    expect(totalAssets).toBe(435000);
    expect(totalLiabilities).toBe(302000);
    expect(netWorth).toBe(133000);
  });

  it("goes negative when debts exceed assets", () => {
    const { netWorth } = computeNetWorth([acct("cash", 1000), acct("credit_card", 5000)]);
    expect(netWorth).toBe(-4000);
  });
});

describe("groupAccountsByBucket", () => {
  it("orders groups by BUCKET_ORDER and omits empty buckets", () => {
    const groups = groupAccountsByBucket([
      acct("credit_card", 2000),
      acct("cash", 5000),
      acct("brokerage", 10000),
    ]);
    expect(groups.map((g) => g.bucket)).toEqual(["cash", "investments", "debt"]);
  });

  it("computes bucketTotal and carries the bucket label", () => {
    const groups = groupAccountsByBucket([
      acct("brokerage", 10000),
      acct("rsu", 5000),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].bucket).toBe("investments");
    expect(groups[0].label).toBe("Investments");
    expect(groups[0].bucketTotal).toBe(15000);
    expect(groups[0].accounts).toHaveLength(2);
  });

  it("returns an empty array for no accounts", () => {
    expect(groupAccountsByBucket([])).toEqual([]);
  });
});
