import { describe, it, expect } from "vitest";
import {
  afterTaxIncome,
  annualContribution,
  coastFiNumber,
  coastLine,
  defaultLevers,
  fiNumber,
  hasIncome,
  hasTaxRate,
  leverRanges,
  leversEqual,
  realReturn,
  savingsRatePct,
  spendingForSavingsRate,
  stockShare,
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
    excludedPassiveIncome: 0,
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

  it("defaults the tax rate to 0 when the profile declares no income, so there is nothing to ask for", () => {
    // No income means no cash income, so nothing is ever derived; a rate on
    // zero income changes nothing, and asking for one would block the page.
    const levers = defaultLevers(inputs({ grossIncome: 0, cashIncome: 0, derivedTaxRatePct: null }));
    expect(levers.effectiveTaxRatePct).toBe(0);
    expect(hasTaxRate(levers)).toBe(true);
  });
});

describe("stockShare", () => {
  it("turns the allocation percent into the fraction the simulation takes", () => {
    expect(stockShare(ready({ stockAllocationPct: 60 }))).toBe(0.6);
  });
});

describe("hasIncome", () => {
  it("is true only for positive income that funds savings", () => {
    expect(hasIncome(inputs())).toBe(true);
    expect(hasIncome(inputs({ grossIncome: 0 }))).toBe(false);
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

describe("coastLine", () => {
  it("has one point per year from now to the target age", () => {
    expect(coastLine(1_000_000, 0.05, 15, 40)).toHaveLength(16);
  });

  it("is the Coast FI number k years from now, ending at the FI number itself", () => {
    const line = coastLine(1_000_000, 0.05, 15, 40)!;
    for (let k = 0; k < 15; k++) expect(line[k]).toBeCloseTo(coastFiNumber(1_000_000, 0.05, 15 - k)!, 6);
    // At the target age there is nothing left to grow: the requirement is the FI number.
    expect(line[15]).toBe(1_000_000);
  });

  it("stops at the horizon when the target is beyond it", () => {
    const line = coastLine(1_000_000, 0.05, 75, 70)!;
    expect(line).toHaveLength(71);
    expect(line[70]).toBeCloseTo(coastFiNumber(1_000_000, 0.05, 5)!, 6);
  });

  it("is null at or past the target age", () => {
    expect(coastLine(1_000_000, 0.05, 0, 40)).toBeNull();
    expect(coastLine(1_000_000, 0.05, -3, 40)).toBeNull();
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

  it("savings max stays at 90 for a default below it", () => {
    // 75,000 after tax, 45,000 spent: 40%.
    expect(leverRanges(inputs(), ready()).savingsRatePct.max).toBe(90);
  });

  it("savings max rises to the next step above a default over 90", () => {
    // 75,000 after tax, 5,700 spent: 92.4%.
    const defaults = ready({ annualSpending: 5_700 });
    expect(leverRanges(inputs(), defaults).savingsRatePct.max).toBe(93);
  });

  it("savings max is 90 when the default savings rate is null", () => {
    expect(leverRanges(inputs({ grossIncome: 0 }), ready()).savingsRatePct.max).toBe(90);
    const noTax = { ...defaultLevers(inputs()), effectiveTaxRatePct: null };
    expect(leverRanges(inputs(), noTax).savingsRatePct.max).toBe(90);
  });

  it("savings min is 0 when the default savings rate is null", () => {
    expect(leverRanges(inputs({ grossIncome: 0 }), ready()).savingsRatePct.min).toBe(0);
  });

  it("savings min is 0 while the tax rate is still null", () => {
    const defaults = { ...defaultLevers(inputs()), effectiveTaxRatePct: null };
    expect(leverRanges(inputs(), defaults).savingsRatePct.min).toBe(0);
  });

  // The profile accepts wider values than the fixed bounds (inflation -5 to
  // 20, withdrawal rate up to 10, real return -10 to 20), and a range input
  // clamps a value outside its bounds without saying so.
  describe("defaults outside the fixed bounds", () => {
    it("withdrawal rate default 7 raises the max to 7", () => {
      const profileInputs = inputs({ profileSafeWithdrawalRatePct: 7 });
      const ranges = leverRanges(profileInputs, defaultLevers(profileInputs));
      expect(ranges.safeWithdrawalRatePct).toEqual({ min: 2.5, max: 7, step: 0.05 });
    });

    it("withdrawal rate default 2 lowers the min to 2", () => {
      const profileInputs = inputs({ profileSafeWithdrawalRatePct: 2 });
      const ranges = leverRanges(profileInputs, defaultLevers(profileInputs));
      expect(ranges.safeWithdrawalRatePct).toEqual({ min: 2, max: 6, step: 0.05 });
    });

    it("inflation default -1 lowers the min to -1", () => {
      const profileInputs = inputs({ profileInflationPct: -1 });
      const ranges = leverRanges(profileInputs, defaultLevers(profileInputs));
      expect(ranges.inflationPct).toEqual({ min: -1, max: 10, step: 0.1 });
    });

    it("nominal default above 15 raises the max to the next step on the 0.1 grid", () => {
      // 1.12 * 1.04 - 1 = 16.48%.
      const profileInputs = inputs({ profileRealReturnPct: 12, profileInflationPct: 4 });
      const defaults = defaultLevers(profileInputs);
      expect(defaults.nominalReturnPct).toBe(16.48);
      expect(leverRanges(profileInputs, defaults).nominalReturnPct).toEqual({ min: -2, max: 16.5, step: 0.1 });
    });

    it("tax default above 60 raises the max", () => {
      const profileInputs = inputs({ derivedTaxRatePct: 61.3 });
      const ranges = leverRanges(profileInputs, defaultLevers(profileInputs));
      expect(ranges.effectiveTaxRatePct).toEqual({ min: 0, max: 61.5, step: 0.5 });
    });

    it("a default on a step is not pushed a step further by float dust", () => {
      // 121 * 0.05 is 6.050000000000001, and divided by the step 121.00000000000001.
      const profileInputs = inputs({ profileSafeWithdrawalRatePct: 121 * 0.05 });
      const ranges = leverRanges(profileInputs, defaultLevers(profileInputs));
      expect(ranges.safeWithdrawalRatePct.max).toBe(6.05);
    });
  });

  describe("current levers", () => {
    it("a current savings rate below the range lowers the min even when the default is 40", () => {
      const defaults = ready();
      const current = ready({ annualSpending: spendingForSavingsRate(inputs(), defaults, -35) });
      expect(savingsRatePct(inputs(), current)).toBeCloseTo(-35, 8);
      expect(leverRanges(inputs(), defaults, current).savingsRatePct.min).toBe(-35);
    });

    it("moving the tax lever cannot push the savings rate off its slider", () => {
      // At 25% tax, 45,000 spent is 40% saved; at 60% tax only 40,000 is left
      // after tax and the same spending is -12.5%.
      const defaults = ready();
      const current = ready({ effectiveTaxRatePct: 60 });
      expect(leverRanges(inputs(), defaults, current).savingsRatePct.min).toBe(-13);
    });

    it("a current value past a bound stretches it, snapped outward to the step", () => {
      const defaults = defaultLevers(inputs());
      const current = { ...defaults, nominalReturnPct: 17.34, inflationPct: -1.05, effectiveTaxRatePct: 62.2 };
      const ranges = leverRanges(inputs(), defaults, current);
      expect(ranges.nominalReturnPct.max).toBe(17.4);
      expect(ranges.inflationPct.min).toBe(-1.1);
      expect(ranges.effectiveTaxRatePct.max).toBe(62.5);
    });

    it("a current value inside the fixed bounds leaves them unchanged", () => {
      const defaults = ready();
      const current = ready({
        nominalReturnPct: 10,
        inflationPct: 2,
        safeWithdrawalRatePct: 3.5,
        stockAllocationPct: 60,
        effectiveTaxRatePct: 30,
        annualSpending: 30_000,
      });
      expect(leverRanges(inputs(), defaults, current)).toEqual(leverRanges(inputs(), defaults));
    });

    it("ignores a current savings rate that cannot be computed", () => {
      const defaults = ready();
      const noTax = { ...defaults, effectiveTaxRatePct: null };
      expect(leverRanges(inputs(), defaults, noTax).savingsRatePct).toEqual({ min: 0, max: 90, step: 1 });
    });
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
