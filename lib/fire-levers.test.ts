import { describe, it, expect } from "vitest";
import {
  afterTaxIncome,
  annualContribution,
  coastFiNumber,
  defaultLevers,
  fiNumber,
  hasTaxRate,
  leverRanges,
  leversEqual,
  realReturn,
  savingsRatePct,
  spendingForSavingsRate,
} from "./fire-levers";
import type { FireInputs, FireLevers } from "./types";

// Synthetic fixtures only (public repo): invented round amounts.

function inputs(overrides: Partial<FireInputs> = {}): FireInputs {
  return {
    asOf: "2026-10-01",
    age: 35,
    targetRetirementAge: 55,
    portfolio: { total: 500_000, cash: 50_000, investments: 250_000, retirement: 200_000, creditCardDebt: 0 },
    spending: {
      annualSpending: 45_000,
      regularAnnual: 45_000,
      amortizedAnnual: 0,
      months: 24,
      fromMonth: "2024-10",
      toMonth: "2026-09",
      cpiThrough: "2026-09",
      amortized: [],
    },
    grossIncome: 100_000,
    cashIncome: 100_000,
    takeHome: null,
    payrollDeductions: 0,
    employerMatch: 3_000,
    derivedTaxRatePct: 25,
    profileRealReturnPct: 5,
    profileInflationPct: 3,
    profileSafeWithdrawalRatePct: 4,
    ...overrides,
  };
}

// Levers with a tax rate set, as the client holds them once it has checked.
function ready(overrides: Partial<FireLevers> = {}) {
  const levers = { ...defaultLevers(inputs()), ...overrides };
  if (!hasTaxRate(levers)) throw new Error("fixture needs a tax rate");
  return levers;
}

describe("defaultLevers and realReturn", () => {
  it("default nominal return reproduces the profile's real return", () => {
    const levers = defaultLevers(inputs());
    expect(levers.nominalReturnPct).toBe(8.15);
    expect(realReturn(levers)).toBeCloseTo(0.05, 10);
  });

  it("seeds spending, allocation, withdrawal rate, inflation and tax from the inputs", () => {
    expect(defaultLevers(inputs())).toEqual({
      nominalReturnPct: 8.15,
      inflationPct: 3,
      annualSpending: 45_000,
      safeWithdrawalRatePct: 4,
      stockAllocationPct: 100,
      effectiveTaxRatePct: 25,
    });
  });

  it("carries a missing derived tax rate through as null", () => {
    expect(defaultLevers(inputs({ derivedTaxRatePct: null })).effectiveTaxRatePct).toBeNull();
  });
});

describe("hasTaxRate", () => {
  it("is true once a tax rate is set, including zero", () => {
    expect(hasTaxRate(defaultLevers(inputs()))).toBe(true);
    expect(hasTaxRate({ ...defaultLevers(inputs()), effectiveTaxRatePct: 0 })).toBe(true);
  });

  it("is false while the tax rate is null", () => {
    expect(hasTaxRate({ ...defaultLevers(inputs()), effectiveTaxRatePct: null })).toBe(false);
  });
});

describe("savings", () => {
  it("savings rate is measured against after-tax profile income", () => {
    const levers = ready();
    expect(afterTaxIncome(inputs(), levers)).toBe(75_000);
    expect(savingsRatePct(inputs(), levers)).toBeCloseTo(40, 10);
  });

  it("savings slider moves spending", () => {
    expect(spendingForSavingsRate(inputs(), ready(), 50)).toBeCloseTo(37_500, 6);
  });

  it("contribution adds the match", () => {
    expect(annualContribution(inputs(), ready())).toBe(33_000);
  });

  it("negative savings produce a negative savings rate", () => {
    expect(savingsRatePct(inputs(), ready({ annualSpending: 90_000 }))).toBeCloseTo(-20, 10);
  });

  it("savings rate is null with no after-tax income", () => {
    expect(savingsRatePct(inputs({ grossIncome: 0 }), ready())).toBeNull();
  });

  it("changing the tax rate leaves spending alone and moves the savings rate", () => {
    const base = ready();
    const taxed = ready({ effectiveTaxRatePct: 40 });
    expect(taxed.annualSpending).toBe(base.annualSpending);
    // 100,000 × 0.6 = 60,000 after tax; (60,000 − 45,000) / 60,000 = 25%.
    expect(savingsRatePct(inputs(), taxed)).toBeCloseTo(25, 10);
  });
});

describe("fiNumber", () => {
  it("FI number is spending over the withdrawal rate", () => {
    expect(fiNumber({ ...defaultLevers(inputs()), annualSpending: 40_000, safeWithdrawalRatePct: 4 })).toBe(1_000_000);
  });
});

describe("coastFiNumber", () => {
  it("coastFiNumber discounts at the real return", () => {
    expect(coastFiNumber(1_000_000, 0.05, 20)).toBeCloseTo(376_889.48, 2);
  });

  it("coastFiNumber is null at or past the target age", () => {
    expect(coastFiNumber(1_000_000, 0.05, 0)).toBeNull();
    expect(coastFiNumber(1_000_000, 0.05, -3)).toBeNull();
  });
});

describe("leverRanges", () => {
  it("returns the fixed slider ranges for the non-savings levers", () => {
    const ranges = leverRanges(inputs(), defaultLevers(inputs()));
    expect(ranges.nominalReturnPct).toEqual({ min: -2, max: 15, step: 0.1 });
    expect(ranges.inflationPct).toEqual({ min: 0, max: 10, step: 0.1 });
    expect(ranges.safeWithdrawalRatePct).toEqual({ min: 2.5, max: 6, step: 0.05 });
    expect(ranges.stockAllocationPct).toEqual({ min: 0, max: 100, step: 5 });
    expect(ranges.effectiveTaxRatePct).toEqual({ min: 0, max: 60, step: 0.5 });
  });

  it("savings range starts at 0 for a positive default savings rate", () => {
    expect(leverRanges(inputs(), ready()).savingsRatePct).toEqual({ min: 0, max: 90, step: 1 });
  });

  it("savings min reaches a negative default savings rate", () => {
    const defaults = ready({ annualSpending: 90_000 });
    expect(leverRanges(inputs(), defaults).savingsRatePct.min).toBe(-20);
  });

  it("savings min floors a fractional negative rate so the default stays on the slider", () => {
    // 75,000 after tax, 90,300 spent: -20.4%.
    const defaults = ready({ annualSpending: 90_300 });
    expect(leverRanges(inputs(), defaults).savingsRatePct.min).toBe(-21);
  });

  it("savings min is 0 when the default savings rate is null", () => {
    expect(leverRanges(inputs({ grossIncome: 0 }), ready()).savingsRatePct.min).toBe(0);
  });

  it("savings min is 0 while the tax rate is still null", () => {
    const defaults = { ...defaultLevers(inputs()), effectiveTaxRatePct: null };
    expect(leverRanges(inputs(), defaults).savingsRatePct.min).toBe(0);
  });
});

describe("leversEqual", () => {
  it("is true for the same values and false when any field differs", () => {
    const a = defaultLevers(inputs());
    expect(leversEqual(a, { ...a })).toBe(true);
    const keys = Object.keys(a) as (keyof FireLevers)[];
    for (const key of keys) {
      const changed = { ...a, [key]: key === "effectiveTaxRatePct" ? null : (a[key] as number) + 1 };
      expect(leversEqual(a, changed)).toBe(false);
    }
  });
});
