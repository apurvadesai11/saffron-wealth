import { describe, it, expect } from "vitest";
import {
  blendReturns,
  horizonYears,
  recenterReturns,
  simulateWindows,
  summarize,
  type SimulationInput,
  type WindowResult,
} from "./fire-simulation";
import { ANNUAL_REAL_RETURNS } from "./market-history-data";

// Synthetic fixtures only (public repo): invented round amounts and returns.

function simulate(overrides: Partial<SimulationInput> = {}): WindowResult[] {
  return simulateWindows({
    portfolio: 100_000,
    contribution: 0,
    fiNumber: 200_000,
    yearsToTarget: 30,
    horizon: 40,
    returns: new Array(40).fill(0.05),
    firstYear: 1900,
    ...overrides,
  });
}

// One window with the given outcomes, for ranking tests that never look at balances.
function result(startYear: number, yearsToFi: number | null, coastFiYears: number | null = null): WindowResult {
  return { startYear, balances: [0], yearsToFi, coastFiYears };
}

describe("blendReturns", () => {
  it("blends 60/40", () => {
    const [blended] = blendReturns([{ year: 1900, stocks: 0.1, bonds: 0.02 }], 0.6);
    expect(blended).toBeCloseTo(0.068, 12);
  });

  it("is all stocks at 1 and all bonds at 0", () => {
    const history = [{ year: 1900, stocks: 0.1, bonds: 0.02 }];
    expect(blendReturns(history, 1)).toEqual([0.1]);
    expect(blendReturns(history, 0)).toEqual([0.02]);
  });
});

describe("recenterReturns", () => {
  it("recentres to the target geometric mean and keeps the ratios", () => {
    const [a, b] = recenterReturns([0.1, -0.1], 0.05);
    expect((1 + a) * (1 + b)).toBeCloseTo(1.05 ** 2, 12);
    expect((1 + a) / (1 + b)).toBeCloseTo(1.1 / 0.9, 12);
  });

  it("leaves a series already at the target alone", () => {
    for (const r of recenterReturns([0.05, 0.05, 0.05], 0.05)) expect(r).toBeCloseTo(0.05, 12);
  });
});

describe("horizonYears", () => {
  it("is the years to the target age, kept between 40 and 70", () => {
    expect(horizonYears(30, 45)).toBe(40);
    expect(horizonYears(25, 70)).toBe(45);
    expect(horizonYears(16, 100)).toBe(70);
  });
});

describe("simulateWindows", () => {
  describe("years to FI", () => {
    it("interpolates years to FI", () => {
      const [first] = simulate();
      expect(first.yearsToFi).toBeCloseTo(14.2027, 3);
    });

    it("counts a mid-year contribution at zero return as a full year of it", () => {
      const [first] = simulate({
        returns: new Array(40).fill(0),
        portfolio: 0,
        contribution: 10_000,
        fiNumber: 50_000,
      });
      expect(first.yearsToFi).toBeCloseTo(5, 10);
    });

    it("is 0 when the portfolio already covers the FI number", () => {
      expect(simulate({ portfolio: 200_000 })[0].yearsToFi).toBe(0);
      expect(simulate({ portfolio: 250_000 })[0].yearsToFi).toBe(0);
    });

    it("never reaches FI with negative contributions and never produces NaN", () => {
      const [first] = simulate({ portfolio: 100_000, contribution: -20_000, fiNumber: 1_000_000 });
      expect(first.yearsToFi).toBeNull();
      expect(first.balances.every(Number.isFinite)).toBe(true);
    });

    it("is null when the horizon ends before the portfolio gets there", () => {
      expect(simulate({ returns: new Array(40).fill(0), fiNumber: 1_000_000 })[0].yearsToFi).toBeNull();
    });
  });

  describe("balances", () => {
    it("runs horizon + 1 balances from today's portfolio", () => {
      const [first] = simulate({ portfolio: 123_000, horizon: 10, returns: new Array(10).fill(0.05) });
      expect(first.balances).toHaveLength(11);
      expect(first.balances[0]).toBe(123_000);
    });

    it("steps with the contribution arriving mid-year", () => {
      const [first] = simulate({ portfolio: 1_000, contribution: 100, horizon: 1, returns: [0.21] });
      // 1,000 * 1.21 + 100 * sqrt(1.21)
      expect(first.balances[1]).toBeCloseTo(1_320, 9);
    });
  });

  describe("coast years", () => {
    it("is the first year the portfolio could stop being added to and still reach FI by the target", () => {
      const zero = new Array(40).fill(0);
      const [first] = simulate({ returns: zero, portfolio: 100_000, contribution: 10_000, fiNumber: 200_000, yearsToTarget: 30 });
      expect(first.coastFiYears).toBe(10);
    });

    it("is null when the target comes before the portfolio can coast", () => {
      const zero = new Array(40).fill(0);
      const [first] = simulate({ returns: zero, portfolio: 100_000, contribution: 10_000, fiNumber: 200_000, yearsToTarget: 5 });
      expect(first.coastFiYears).toBeNull();
    });

    it("is null when there are no years to the target", () => {
      expect(simulate({ yearsToTarget: 0 })[0].coastFiYears).toBeNull();
      expect(simulate({ yearsToTarget: -3 })[0].coastFiYears).toBeNull();
    });

    it("is 0 when today's portfolio already grows to the FI number by the target", () => {
      // 100,000 * 1.05^30 is about 432,000, above 200,000.
      expect(simulate({ yearsToTarget: 30 })[0].coastFiYears).toBe(0);
    });

    it("compounds the portfolio over the years left to the target, not the horizon", () => {
      // 1.05^14 * 100,000 = 197,993 misses 200,000; 1.05^15 reaches it.
      expect(simulate({ yearsToTarget: 14 })[0].coastFiYears).toBeNull();
      expect(simulate({ yearsToTarget: 15 })[0].coastFiYears).toBe(0);
    });

    it("reads the target as the horizon when the target lies beyond it", () => {
      const zero = new Array(10).fill(0);
      const [first] = simulate({ returns: zero, horizon: 10, portfolio: 100_000, contribution: 10_000, fiNumber: 200_000, yearsToTarget: 50 });
      expect(first.coastFiYears).toBe(10);
    });
  });

  describe("windows", () => {
    it("uses complete windows only", () => {
      const results = simulate({ returns: new Array(50).fill(0.05), horizon: 40, firstYear: 1900 });
      expect(results).toHaveLength(11);
      expect(results.map((r) => r.startYear)).toEqual(Array.from({ length: 11 }, (_, i) => 1900 + i));
    });

    it("gives one window when the history is exactly the horizon", () => {
      expect(simulate({ returns: new Array(40).fill(0.05) })).toHaveLength(1);
    });

    it("replays each window's own years", () => {
      const returns = [0.5, 0, 0];
      const results = simulate({ returns, horizon: 2, portfolio: 100, fiNumber: 1_000_000, yearsToTarget: 2 });
      expect(results.map((r) => r.balances)).toEqual([
        [100, 150, 150],
        [100, 100, 100],
      ]);
    });

    it("throws when the history is shorter than the horizon", () => {
      expect(() => simulate({ returns: new Array(39).fill(0.05), horizon: 40 })).toThrow();
    });
  });
});

describe("summarize", () => {
  it("ranks with nearest rank and nulls last", () => {
    const results = [3, 1, 7, 10, 5, 2, 9, 4, 8, 6].map((years, i) => result(1900 + i, years));
    const { fi } = summarize(results, 30);
    expect(fi.map((row) => row.label)).toEqual(["Best", "Optimistic", "Neutral", "Pessimistic", "Worst"]);
    expect(fi.map((row) => row.years)).toEqual([1, 1, 5, 9, 10]);

    const withNull = summarize(
      results.map((r) => (r.yearsToFi === 10 ? { ...r, yearsToFi: null } : r)),
      30,
    );
    expect(withNull.fi.map((row) => row.years)).toEqual([1, 1, 5, 9, null]);
  });

  it("carries the start year of the window at each rank", () => {
    const results = [result(1950, 8), result(1960, 2), result(1970, 5)];
    const { fi } = summarize(results, 30);
    expect(fi.find((row) => row.label === "Best")).toEqual({ label: "Best", years: 2, startYear: 1960 });
    expect(fi.find((row) => row.label === "Worst")).toEqual({ label: "Worst", years: 8, startYear: 1950 });
  });

  it("breaks ties by the earlier start year", () => {
    const { fi } = summarize([result(1980, 4), result(1950, 4), result(1960, 4)], 30);
    // Three equal windows, ranked 1950, 1960, 1980 by the tie-break.
    expect(fi.map((row) => row.startYear)).toEqual([1950, 1950, 1960, 1980, 1980]);
  });

  it("ranks coast years independently of years to FI", () => {
    const results = [result(1900, 1, 9), result(1910, 9, 1), result(1920, 5, 5)];
    const { fi, coast } = summarize(results, 30);
    expect(fi[0]).toEqual({ label: "Best", years: 1, startYear: 1900 });
    expect(coast[0]).toEqual({ label: "Best", years: 1, startYear: 1910 });
    expect(coast[4]).toEqual({ label: "Worst", years: 9, startYear: 1900 });
  });

  it("shares the share of windows reaching FI by the target age", () => {
    const results = [5, 10, 15, null].map((years, i) => result(1900 + i, years));
    expect(summarize(results, 10).reachedByTargetShare).toBe(0.5);
  });

  it("shares the windows already coasting today", () => {
    const results = [0, 0, 3, null].map((years, i) => result(1900 + i, 5, years));
    expect(summarize(results, 10).coastNowShare).toBe(0.5);
  });

  it("reports the windows it ranked", () => {
    const { windowCount, firstStartYear, lastStartYear } = summarize([result(1930, 3), result(1900, 3), result(1915, 3)], 10);
    expect(windowCount).toBe(3);
    expect(firstStartYear).toBe(1900);
    expect(lastStartYear).toBe(1930);
  });

  it("builds p10 / p50 / p90 bands of the balance in every year", () => {
    const results = Array.from({ length: 10 }, (_, i) => ({
      startYear: 1900 + i,
      balances: [100, 100 + (i + 1) * 10, 100 + (i + 1) * 100],
      yearsToFi: null,
      coastFiYears: null,
    }));
    const { bands } = summarize(results, 10);
    expect(bands).toEqual([
      { year: 0, p10: 100, p50: 100, p90: 100 },
      { year: 1, p10: 110, p50: 150, p90: 190 },
      { year: 2, p10: 200, p50: 600, p90: 1_000 },
    ]);
  });

  it("throws on no windows", () => {
    expect(() => summarize([], 10)).toThrow();
  });
});

describe("against the real market history", () => {
  it("runs every 40-year window of the table, recentred and all stocks", () => {
    const returns = recenterReturns(blendReturns(ANNUAL_REAL_RETURNS, 1), 0.05);
    const results = simulateWindows({
      portfolio: 300_000,
      contribution: 40_000,
      fiNumber: 1_200_000,
      yearsToTarget: 30,
      horizon: 40,
      returns,
      firstYear: ANNUAL_REAL_RETURNS[0].year,
    });
    expect(results).toHaveLength(ANNUAL_REAL_RETURNS.length - 40 + 1);
    expect(results[0].startYear).toBe(ANNUAL_REAL_RETURNS[0].year);
    expect(results.every((r) => r.yearsToFi === null || Number.isFinite(r.yearsToFi))).toBe(true);

    const summary = summarize(results, 30);
    expect(summary.bands).toHaveLength(41);
    expect(summary.windowCount).toBe(results.length);
  });
});
