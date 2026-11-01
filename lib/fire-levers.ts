// The FIRE page's sliders and the numbers derived from them. Pure — no React,
// no DB, no market data.
//
// This is the one place the page's percent-as-typed values (5 means 5%)
// become the fractions lib/fire-simulation.ts takes (0.05). Keeping the
// conversion here means no other file has to remember which unit it holds.
//
// The state is spending, not the savings rate. The savings-rate slider is a
// view of spending, so editing the tax rate leaves spending where the user put
// it and moves the savings rate, rather than silently changing what they spend.
// The savings arithmetic is decision 0017's:
// docs/decisions/0017-fire-savings-from-profile-income.md

import type { FireInputs, FireLevers } from "./types";

// Levers once the tax rate is known. Everything that starts from income needs
// one, and the type makes the page check before calling rather than discover a
// null at runtime.
export type ReadyLevers = FireLevers & { effectiveTaxRatePct: number };

export function hasTaxRate(levers: FireLevers): levers is ReadyLevers {
  return levers.effectiveTaxRatePct !== null;
}

export type LeverKey =
  | "nominalReturnPct"
  | "inflationPct"
  | "savingsRatePct"
  | "safeWithdrawalRatePct"
  | "stockAllocationPct"
  | "effectiveTaxRatePct";

export interface LeverRange {
  min: number;
  max: number;
  step: number;
}

const SAVINGS_RATE_MAX_PCT = 90;

// Rate arithmetic leaves dust (-20 comes out as -20.000000000000004), and a
// floor over dust would put the slider's minimum a whole step below a default
// that is, to every displayed digit, on a step.
const FLOOR_TOLERANCE = 1e-9;

function roundToHundredth(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Starting levers. The profile states a real return and an inflation rate, but
 * the return slider is nominal (it is the figure people compare with an index
 * fund's history), so the nominal default is the one that reproduces the
 * profile's real return: (1 + real)(1 + inflation) − 1. It is rounded to 2 dp
 * because the slider steps in tenths and a longer default would not sit on it.
 */
export function defaultLevers(inputs: FireInputs): FireLevers {
  const nominal = (1 + inputs.profileRealReturnPct / 100) * (1 + inputs.profileInflationPct / 100) - 1;
  return {
    nominalReturnPct: roundToHundredth(nominal * 100),
    inflationPct: inputs.profileInflationPct,
    annualSpending: inputs.spending.annualSpending,
    safeWithdrawalRatePct: inputs.profileSafeWithdrawalRatePct,
    stockAllocationPct: 100,
    effectiveTaxRatePct: inputs.derivedTaxRatePct,
  };
}

/** The real return as a fraction: (1 + nominal) / (1 + inflation) − 1. */
export function realReturn(levers: FireLevers): number {
  return (1 + levers.nominalReturnPct / 100) / (1 + levers.inflationPct / 100) - 1;
}

/** Profile income left after the tax-rate lever, per year. */
export function afterTaxIncome(inputs: FireInputs, levers: ReadyLevers): number {
  return inputs.grossIncome * (1 - levers.effectiveTaxRatePct / 100);
}

/**
 * Share of after-tax income not spent, in percent and unrounded (the UI
 * formats it). Negative when spending exceeds income; null when there is no
 * after-tax income to take a share of.
 */
export function savingsRatePct(inputs: FireInputs, levers: ReadyLevers): number | null {
  const income = afterTaxIncome(inputs, levers);
  if (income <= 0) return null;
  return ((income - levers.annualSpending) / income) * 100;
}

/** The spending that leaves the given savings rate: what the savings slider writes. */
export function spendingForSavingsRate(inputs: FireInputs, levers: ReadyLevers, pct: number): number {
  return afterTaxIncome(inputs, levers) * (1 - pct / 100);
}

/**
 * What goes into the portfolio each year: after-tax income minus spending, plus
 * the employer match, which never passes through the paycheck or the bank and
 * so is in neither.
 */
export function annualContribution(inputs: FireInputs, levers: ReadyLevers): number {
  return afterTaxIncome(inputs, levers) - levers.annualSpending + inputs.employerMatch;
}

/** The portfolio that supports the spending at the withdrawal rate. */
export function fiNumber(levers: FireLevers): number {
  return levers.annualSpending / (levers.safeWithdrawalRatePct / 100);
}

/**
 * What the portfolio must be today to grow, untouched, to the FI number by the
 * target age. Null when the target age is now or past, where "coast" has no
 * meaning.
 */
export function coastFiNumber(fi: number, realReturn: number, yearsToTarget: number): number | null {
  if (yearsToTarget <= 0) return null;
  return fi / (1 + realReturn) ** yearsToTarget;
}

/**
 * Slider bounds. The savings range reaches down to a negative default so a
 * household that overspends today can still see its own starting point; with
 * no default savings rate (no tax rate yet, or no after-tax income) it starts
 * at 0.
 */
export function leverRanges(inputs: FireInputs, defaults: FireLevers): Record<LeverKey, LeverRange> {
  const defaultSavings = hasTaxRate(defaults) ? savingsRatePct(inputs, defaults) : null;
  const savingsMin = defaultSavings === null ? 0 : Math.min(0, Math.floor(defaultSavings + FLOOR_TOLERANCE));
  return {
    nominalReturnPct: { min: -2, max: 15, step: 0.1 },
    inflationPct: { min: 0, max: 10, step: 0.1 },
    savingsRatePct: { min: savingsMin, max: SAVINGS_RATE_MAX_PCT, step: 1 },
    safeWithdrawalRatePct: { min: 2.5, max: 6, step: 0.05 },
    stockAllocationPct: { min: 0, max: 100, step: 5 },
    effectiveTaxRatePct: { min: 0, max: 60, step: 0.5 },
  };
}

export function leversEqual(a: FireLevers, b: FireLevers): boolean {
  return (
    a.nominalReturnPct === b.nominalReturnPct &&
    a.inflationPct === b.inflationPct &&
    a.annualSpending === b.annualSpending &&
    a.safeWithdrawalRatePct === b.safeWithdrawalRatePct &&
    a.stockAllocationPct === b.stockAllocationPct &&
    a.effectiveTaxRatePct === b.effectiveTaxRatePct
  );
}
