// Replays every complete rolling window of real US market history against the
// user's plan and reports how long each one takes to reach the FI number. Pure
// — no React, no DB. The history is a parameter, so tests use small synthetic
// series.
//
// Everything here is a fraction (0.05, not 5) and every dollar is real
// (today's). lib/fire-levers.ts owns the percent-to-fraction conversion.
//
// Why history instead of Monte Carlo, why the log-space recentring, and why
// complete windows only: docs/decisions/0015-fire-recentred-historical-sequences.md

import type { AnnualRealReturn } from "./types";

export const MIN_HORIZON_YEARS = 40;
export const MAX_HORIZON_YEARS = 70;

/** Annual real return of a stock/bond mix, rebalanced to `stockShare` (0 to 1) every year. */
export function blendReturns(history: AnnualRealReturn[], stockShare: number): number[] {
  return history.map((row) => stockShare * row.stocks + (1 - stockShare) * row.bonds);
}

/**
 * Shifts a series so its geometric mean is `targetReal`, leaving the year-to-year
 * ratios alone. The shift is in log space: an arithmetic shift would leave the
 * median path about σ²/2 below the return the user declared. Every `1 + r`
 * must be positive, which no real annual return and no slider position breaks.
 */
export function recenterReturns(returns: number[], targetReal: number): number[] {
  const logs = returns.map((r) => Math.log1p(r));
  const meanLog = logs.reduce((sum, l) => sum + l, 0) / logs.length;
  const targetLog = Math.log1p(targetReal);
  return logs.map((l) => Math.expm1(l - meanLog + targetLog));
}

/** Years to simulate: out to the target age, but never fewer than 40 or more than 70. */
export function horizonYears(age: number, targetRetirementAge: number): number {
  return Math.min(MAX_HORIZON_YEARS, Math.max(MIN_HORIZON_YEARS, targetRetirementAge - age));
}

export interface SimulationInput {
  portfolio: number;
  // Added to the portfolio each year; negative when the household overspends.
  contribution: number;
  fiNumber: number;
  yearsToTarget: number;
  horizon: number;
  returns: number[];
  // The calendar year of returns[0], so each window can say where it started.
  firstYear: number;
}

export interface WindowResult {
  startYear: number;
  // Length horizon + 1; balances[0] is today's portfolio.
  balances: number[];
  yearsToFi: number | null;
  coastFiYears: number | null;
}

/**
 * One result per start year with `horizon` years of history after it. Windows
 * that run off the end of the table are dropped rather than wrapped around to
 * 1871, which would splice 2025 onto a sequence that never happened.
 */
export function simulateWindows(input: SimulationInput): WindowResult[] {
  const { portfolio, contribution, fiNumber, yearsToTarget, horizon, returns, firstYear } = input;
  if (returns.length < horizon) {
    throw new Error(`A ${horizon}-year horizon needs ${horizon} years of returns; got ${returns.length}`);
  }

  // Growth over any stretch of years is exp of a difference of these.
  const logPrefix = [0];
  for (const r of returns) logPrefix.push(logPrefix[logPrefix.length - 1] + Math.log1p(r));

  // Ages are whole years, so this only matters to keep an index an integer.
  const coastEnd = Math.min(Math.floor(yearsToTarget), horizon);

  const results: WindowResult[] = [];
  for (let start = 0; start + horizon <= returns.length; start++) {
    const balances = [portfolio];
    for (let k = 0; k < horizon; k++) {
      const growth = 1 + returns[start + k];
      // The contribution arrives through the year, so it earns half a year's return.
      balances.push(balances[k] * growth + contribution * Math.sqrt(growth));
    }

    results.push({
      startYear: firstYear + start,
      balances,
      yearsToFi: yearsToReach(balances, fiNumber),
      coastFiYears: yearsToTarget > 0 ? firstCoastYear(balances, logPrefix, start, coastEnd, fiNumber) : null,
    });
  }
  return results;
}

// Linear interpolation inside the year the balance crosses; null if it never does.
function yearsToReach(balances: number[], target: number): number | null {
  if (balances[0] >= target) return 0;
  for (let k = 0; k + 1 < balances.length; k++) {
    if (balances[k + 1] >= target) {
      return k + (target - balances[k]) / (balances[k + 1] - balances[k]);
    }
  }
  return null;
}

// The first year in which stopping contributions would still let the balance
// grow, on this window's own returns, to the FI number by the target.
function firstCoastYear(
  balances: number[],
  logPrefix: number[],
  start: number,
  coastEnd: number,
  target: number,
): number | null {
  for (let k = 0; k <= coastEnd; k++) {
    const grown = balances[k] * Math.exp(logPrefix[start + coastEnd] - logPrefix[start + k]);
    if (grown >= target) return k;
  }
  return null;
}

export type ScenarioLabel = "Best" | "Optimistic" | "Neutral" | "Pessimistic" | "Worst";

export interface ScenarioRow {
  label: ScenarioLabel;
  years: number | null;
  startYear: number;
}

export interface FireSummary {
  fi: ScenarioRow[];
  coast: ScenarioRow[];
  windowCount: number;
  firstStartYear: number;
  lastStartYear: number;
  reachedByTargetShare: number;
  coastNowShare: number;
  // Percentiles of the balance across windows, for every year from now. `year`
  // is years from now; the chart adds the age.
  bands: { year: number; p10: number; p50: number; p90: number }[];
}

// Best and Worst are the ends of the same rule the middle rows use, so every
// pick in this file goes through nearestRank.
const SCENARIOS: { label: ScenarioLabel; p: number }[] = [
  { label: "Best", p: 0 },
  { label: "Optimistic", p: 0.1 },
  { label: "Neutral", p: 0.5 },
  { label: "Pessimistic", p: 0.9 },
  { label: "Worst", p: 1 },
];

// Index of the p-th percentile in a sorted list of n by the nearest-rank method.
function nearestRank(p: number, n: number): number {
  return Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1));
}

// Shortest first, windows that never get there last; ties by start year so the
// pick does not depend on the order the caller passed the results in.
function compareOutcomes(a: { years: number | null; startYear: number }, b: { years: number | null; startYear: number }) {
  if (a.years === null && b.years === null) return a.startYear - b.startYear;
  if (a.years === null) return 1;
  if (b.years === null) return -1;
  return a.years - b.years || a.startYear - b.startYear;
}

function scenarioRows(results: WindowResult[], pick: (r: WindowResult) => number | null): ScenarioRow[] {
  const ranked = results
    .map((r) => ({ years: pick(r), startYear: r.startYear }))
    .sort(compareOutcomes);
  return SCENARIOS.map(({ label, p }) => ({ label, ...ranked[nearestRank(p, ranked.length)] }));
}

export function summarize(results: WindowResult[], yearsToTarget: number): FireSummary {
  if (results.length === 0) throw new Error("summarize needs at least one window");
  const n = results.length;
  const startYears = results.map((r) => r.startYear);

  const bands = results[0].balances.map((_, k) => {
    const sorted = results.map((r) => r.balances[k]).sort((a, b) => a - b);
    return {
      year: k,
      p10: sorted[nearestRank(0.1, n)],
      p50: sorted[nearestRank(0.5, n)],
      p90: sorted[nearestRank(0.9, n)],
    };
  });

  return {
    fi: scenarioRows(results, (r) => r.yearsToFi),
    coast: scenarioRows(results, (r) => r.coastFiYears),
    windowCount: n,
    firstStartYear: Math.min(...startYears),
    lastStartYear: Math.max(...startYears),
    reachedByTargetShare: results.filter((r) => r.yearsToFi !== null && r.yearsToFi <= yearsToTarget).length / n,
    coastNowShare: results.filter((r) => r.coastFiYears === 0).length / n,
    bands,
  };
}
