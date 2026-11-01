import { describe, it, expect } from "vitest";
import { ANNUAL_REAL_RETURNS, MARKET_HISTORY_SOURCE } from "./market-history-data";
import { MONTHLY_CPI } from "./cpi-data";

// These pin the shape and plausibility of the generated tables, not Shiller's
// exact numbers: a mis-parsed column (price instead of total return, nominal
// instead of real, a shifted header) lands outside these bounds, while a
// legitimate refresh of the spreadsheet does not.
describe("ANNUAL_REAL_RETURNS", () => {
  it("years are contiguous from 1871", () => {
    expect(ANNUAL_REAL_RETURNS[0].year).toBe(1871);
    for (let i = 1; i < ANNUAL_REAL_RETURNS.length; i++) {
      expect(ANNUAL_REAL_RETURNS[i].year).toBe(ANNUAL_REAL_RETURNS[i - 1].year + 1);
    }
    expect(ANNUAL_REAL_RETURNS[ANNUAL_REAL_RETURNS.length - 1].year).toBeGreaterThanOrEqual(2025);
  });

  it("every return is plausible", () => {
    for (const row of ANNUAL_REAL_RETURNS) {
      expect(row.stocks).toBeGreaterThan(-0.6);
      expect(row.stocks).toBeLessThan(0.7);
      expect(row.bonds).toBeGreaterThan(-0.6);
      expect(row.bonds).toBeLessThan(0.7);
    }
  });

  it("1931 was a crash", () => {
    const row = ANNUAL_REAL_RETURNS.find((r) => r.year === 1931);
    expect(row).toBeDefined();
    expect(row!.stocks).toBeLessThan(-0.3);
  });

  it("long-run stock CAGR is in the historical range", () => {
    const logSum = ANNUAL_REAL_RETURNS.reduce((sum, r) => sum + Math.log(1 + r.stocks), 0);
    const cagr = Math.exp(logSum / ANNUAL_REAL_RETURNS.length) - 1;
    expect(cagr).toBeGreaterThanOrEqual(0.05);
    expect(cagr).toBeLessThanOrEqual(0.08);
  });
});

describe("MONTHLY_CPI", () => {
  // Month keys are plain "YYYY-MM" strings; the successor is computed from the
  // digits so no Date (and no timezone) is involved.
  function nextMonth(key: string): string {
    const [y, m] = key.split("-").map(Number);
    return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  }

  it("CPI months are contiguous and positive", () => {
    expect(MONTHLY_CPI[0].month).toBe("1970-01");
    for (let i = 1; i < MONTHLY_CPI.length; i++) {
      expect(MONTHLY_CPI[i].month).toBe(nextMonth(MONTHLY_CPI[i - 1].month));
    }
    for (const row of MONTHLY_CPI) {
      expect(row.cpi).toBeGreaterThan(0);
    }
  });
});

describe("MARKET_HISTORY_SOURCE", () => {
  it("source names the last month", () => {
    expect(MARKET_HISTORY_SOURCE.lastMonth).toBe(MONTHLY_CPI[MONTHLY_CPI.length - 1].month);
  });
});
