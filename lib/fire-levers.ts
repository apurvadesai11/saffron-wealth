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

// Rate arithmetic leaves dust (-20 comes out as -20.000000000000004), and a
// floor or ceiling over dust would put a slider bound a whole step past a
// default that is, to every displayed digit, on a step.
const ROUNDING_TOLERANCE = 1e-9;

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

// Bounds the sliders keep when nothing needs more room. Every min and max is a
// multiple of its step, which is what lets stretching snap to a grid anchored
// at zero.
const BASE_RANGES: Record<LeverKey, LeverRange> = {
  nominalReturnPct: { min: -2, max: 15, step: 0.1 },
  inflationPct: { min: 0, max: 10, step: 0.1 },
  savingsRatePct: { min: 0, max: 90, step: 1 },
  safeWithdrawalRatePct: { min: 2.5, max: 6, step: 0.05 },
  stockAllocationPct: { min: 0, max: 100, step: 5 },
  effectiveTaxRatePct: { min: 0, max: 60, step: 0.5 },
};

// Multiples of a step like 0.1 carry binary dust (3 * 0.1 is
// 0.30000000000000004); six places is far finer than any step here.
function cleanGridValue(value: number): number {
  return Math.round(value * 1e6) / 1e6 || 0;
}

// Widens a range to hold each value, rounding outward to the next step so the
// value itself is selectable. Null values (a savings rate that cannot be
// computed) leave the range alone.
function stretchToInclude(range: LeverRange, values: (number | null)[]): LeverRange {
  let { min, max } = range;
  for (const value of values) {
    if (value === null) continue;
    const steps = value / range.step;
    min = Math.min(min, cleanGridValue(Math.floor(steps + ROUNDING_TOLERANCE) * range.step));
    max = Math.max(max, cleanGridValue(Math.ceil(steps - ROUNDING_TOLERANCE) * range.step));
  }
  return { ...range, min, max };
}

/**
 * Slider bounds. Each keeps its fixed range unless the lever's value falls
 * outside it, and then the range stretches to hold the value, because a range
 * input clamps a value outside its bounds without saying so and the page would
 * show a lever at a figure the plan is not using. The profile accepts more than
 * the fixed bounds do (inflation below 0 or above 10, a withdrawal rate of 7%),
 * so a default can start outside them; a household that overspends starts at a
 * negative savings rate, and one that saves nearly everything above 90.
 *
 * Pass the initial `defaults` and the live levers as `current`. Both are kept
 * on the slider, so dragging one lever (the tax rate moves the savings rate)
 * cannot carry another off its end. `current` defaults to `defaults` for the
 * first render.
 *
 * The savings rate takes part only when it can be computed: with no tax rate,
 * or no after-tax income, that range stays 0 to 90.
 */
export function leverRanges(
  inputs: FireInputs,
  defaults: FireLevers,
  current: FireLevers = defaults,
): Record<LeverKey, LeverRange> {
  const savingsRate = (levers: FireLevers) => (hasTaxRate(levers) ? savingsRatePct(inputs, levers) : null);
  const stretch = (key: LeverKey, ...values: (number | null)[]) => stretchToInclude(BASE_RANGES[key], values);
  return {
    nominalReturnPct: stretch("nominalReturnPct", defaults.nominalReturnPct, current.nominalReturnPct),
    inflationPct: stretch("inflationPct", defaults.inflationPct, current.inflationPct),
    savingsRatePct: stretch("savingsRatePct", savingsRate(defaults), savingsRate(current)),
    safeWithdrawalRatePct: stretch(
      "safeWithdrawalRatePct",
      defaults.safeWithdrawalRatePct,
      current.safeWithdrawalRatePct,
    ),
    stockAllocationPct: stretch("stockAllocationPct", defaults.stockAllocationPct, current.stockAllocationPct),
    effectiveTaxRatePct: stretch("effectiveTaxRatePct", defaults.effectiveTaxRatePct, current.effectiveTaxRatePct),
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
