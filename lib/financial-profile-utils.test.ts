import { describe, it, expect } from "vitest";
import {
  INCOME_KINDS,
  DEFAULT_FREQUENCY_BY_KIND,
  ageOn,
  totalAnnualIncome,
  isContributionEligible,
  isIncomeKind,
  isPayFrequency,
  isFilingStatus,
  toProfileInput,
  profileInputsEqual,
} from "./financial-profile-utils";
import type { FinancialProfile, FinancialProfileInput } from "./types";

function input(overrides: Partial<FinancialProfileInput> = {}): FinancialProfileInput {
  return {
    age: 35,
    targetRetirementAge: 50,
    expectedRealReturnPct: 5,
    safeWithdrawalRatePct: 3.5,
    inflationPct: 2.5,
    filingStatus: "single",
    employerMatch: { matchPct: 50, limitPct: 6 },
    incomeStreams: [
      { kind: "salary", label: null, annualAmount: 90000, frequency: "biweekly" },
      { kind: "rsu", label: "Example Co RSUs", annualAmount: 20000, frequency: "quarterly" },
    ],
    contributionTargets: [{ accountId: "acct_1", annualAmount: 23000 }],
    ...overrides,
  };
}

describe("ageOn", () => {
  const saved = { ageAtEffective: 35, effectiveAt: "2026-10-31T12:00:00.000Z" };

  it("holds the typed age until the anniversary of the save", () => {
    expect(ageOn(saved, new Date("2026-10-31T12:00:00.000Z"))).toBe(35);
    expect(ageOn(saved, new Date("2027-10-31T11:59:00.000Z"))).toBe(35);
  });

  it("advances by one on the anniversary of the save", () => {
    expect(ageOn(saved, new Date("2027-10-31T12:00:00.000Z"))).toBe(36);
    expect(ageOn(saved, new Date("2036-11-01T00:00:00.000Z"))).toBe(45);
  });

  it("treats a leap-day save's anniversary as March 1st in common years", () => {
    const leap = { ageAtEffective: 35, effectiveAt: "2028-02-29T09:00:00.000Z" };
    expect(ageOn(leap, new Date("2029-02-28T23:59:00.000Z"))).toBe(35);
    expect(ageOn(leap, new Date("2029-03-01T09:00:00.000Z"))).toBe(36);
  });

  it("never goes below the typed age for an instant before the save", () => {
    expect(ageOn(saved, new Date("2025-01-01T00:00:00.000Z"))).toBe(35);
  });
});

describe("totalAnnualIncome", () => {
  it("sums to the cent without float dust", () => {
    expect(totalAnnualIncome([{ annualAmount: 0.1 }, { annualAmount: 0.2 }])).toBe(0.3);
  });

  it("is zero for no streams", () => {
    expect(totalAnnualIncome([])).toBe(0);
  });
});

describe("isContributionEligible", () => {
  it("accepts cash, investment and retirement accounts", () => {
    expect(isContributionEligible("cash")).toBe(true);
    expect(isContributionEligible("brokerage")).toBe(true);
    expect(isContributionEligible("roth_ira")).toBe(true);
  });

  it("rejects debt, real estate and uncategorized accounts", () => {
    expect(isContributionEligible("credit_card")).toBe(false);
    expect(isContributionEligible("property")).toBe(false);
    expect(isContributionEligible("uncategorized")).toBe(false);
  });
});

describe("type guards", () => {
  it("recognize only their own unions", () => {
    expect(isIncomeKind("rsu")).toBe(true);
    expect(isIncomeKind("dividends")).toBe(false);
    expect(isPayFrequency("semimonthly")).toBe(true);
    expect(isPayFrequency("fortnightly")).toBe(false);
    expect(isFilingStatus("married_joint")).toBe(true);
    expect(isFilingStatus("married")).toBe(false);
    expect(isFilingStatus(undefined)).toBe(false);
  });
});

describe("DEFAULT_FREQUENCY_BY_KIND", () => {
  it("has an entry for every income kind", () => {
    for (const kind of INCOME_KINDS) {
      expect(DEFAULT_FREQUENCY_BY_KIND).toHaveProperty(kind);
    }
  });
});

describe("toProfileInput", () => {
  it("restates a saved version as input with the derived age", () => {
    const { age, ...rest } = input();
    const profile: FinancialProfile = {
      ...rest,
      version: 1,
      effectiveAt: "2026-10-31T12:00:00.000Z",
      ageAtEffective: age,
    };
    expect(toProfileInput(profile, new Date("2028-01-01T00:00:00.000Z"))).toEqual(
      input({ age: 36 }),
    );
  });
});

describe("profileInputsEqual", () => {
  it("is true for identical inputs", () => {
    expect(profileInputsEqual(input(), input())).toBe(true);
  });

  it("is false when one stream's label differs", () => {
    const changed = input();
    changed.incomeStreams[1] = { ...changed.incomeStreams[1], label: "Other Co RSUs" };
    expect(profileInputsEqual(input(), changed)).toBe(false);
  });

  it("treats a reorder of the income streams as a change", () => {
    const swapped = input();
    swapped.incomeStreams.reverse();
    expect(profileInputsEqual(input(), swapped)).toBe(false);
  });

  it("distinguishes no employer match from a match", () => {
    expect(profileInputsEqual(input(), input({ employerMatch: null }))).toBe(false);
  });

  it("is false when a contribution amount differs", () => {
    expect(
      profileInputsEqual(
        input(),
        input({ contributionTargets: [{ accountId: "acct_1", annualAmount: 23500 }] }),
      ),
    ).toBe(false);
  });
});
