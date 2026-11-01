import { describe, it, expect } from "vitest";
import {
  BIG_PURCHASE_LIFE_YEARS,
  BIG_PURCHASE_THRESHOLD,
  cpiFactor,
  merchantKey,
  isRecurringCharge,
  computeSpendingBaseline,
} from "./fire-spending";
import type { MonthlyCpi, Transaction } from "./types";

// Synthetic fixtures only (public repo): invented merchants and round amounts.

function monthIndex(month: string): number {
  return Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
}

function monthFromIndex(index: number): string {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Every month from `from` to `to` inclusive, as "YYYY-MM". */
function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let i = monthIndex(from); i <= monthIndex(to); i++) out.push(monthFromIndex(i));
  return out;
}

/** A contiguous monthly table running linearly from one level to another. */
function linearCpi(from: string, fromCpi: number, to: string, toCpi: number): MonthlyCpi[] {
  const span = monthIndex(to) - monthIndex(from);
  return monthsBetween(from, to).map((month, i) => ({
    month,
    cpi: fromCpi + ((toCpi - fromCpi) * i) / span,
  }));
}

/** A contiguous monthly table at a constant level, so a restatement is a no-op. */
function flatCpi(from: string, to: string): MonthlyCpi[] {
  return monthsBetween(from, to).map((month) => ({ month, cpi: 100 }));
}

let nextId = 0;
function tx(overrides: Partial<Transaction> = {}): Transaction {
  nextId += 1;
  return {
    id: `t${nextId}`,
    description: "Purchase",
    amount: 100,
    categoryId: "misc",
    type: "expense",
    date: "2025-06-15",
    merchant: null,
    ...overrides,
  };
}

/** One charge on the 3rd of every month from `from` to `to` inclusive. */
function monthly(from: string, to: string, amount: number, merchant: string): Transaction[] {
  return monthsBetween(from, to).map((month) => tx({ merchant, description: merchant, amount, date: `${month}-03` }));
}

// Local calendar fields, because period math is local (see decision 0010).
const OCT_15_2026 = new Date(2026, 9, 15);

describe("cpiFactor", () => {
  const table = linearCpi("2024-01", 300, "2025-01", 309);

  it("cpiFactor inside the table", () => {
    expect(cpiFactor("2024-01", "2025-01", table, 2.5)).toBeCloseTo(1.03, 10);
  });

  it("is 1 for a month against itself", () => {
    expect(cpiFactor("2024-07", "2024-07", table, 2.5)).toBe(1);
  });

  it("cpiFactor extends past the table at the profile rate", () => {
    // 309 × 1.04^(6/12) / 300: six months past the last month at 4% a year.
    expect(cpiFactor("2024-01", "2025-07", table, 4)).toBeCloseTo(1.050398, 6);
  });

  it("holds the last level flat when the profile rate is 0", () => {
    expect(cpiFactor("2025-01", "2026-01", table, 0)).toBe(1);
  });

  it("clamps a month before the table to its first value", () => {
    expect(cpiFactor("2020-05", "2024-01", table, 2.5)).toBe(1);
    expect(cpiFactor("2020-05", "2025-01", table, 2.5)).toBeCloseTo(1.03, 10);
  });

  it("reads across a year boundary", () => {
    const flat = flatCpi("2024-11", "2025-02");
    expect(cpiFactor("2024-11", "2025-02", flat, 2.5)).toBe(1);
  });

  it("refuses an empty table rather than guessing a factor", () => {
    expect(() => cpiFactor("2024-01", "2025-01", [], 2.5)).toThrow(/empty/);
  });
});

describe("merchantKey", () => {
  it("merchantKey falls back to the description", () => {
    expect(merchantKey({ merchant: "  Costco ", description: "Warehouse run" })).toBe("costco");
    expect(merchantKey({ merchant: null, description: "Rent" })).toBe("rent");
    expect(merchantKey({ description: "  RENT " })).toBe("rent");
  });
});

describe("isRecurringCharge", () => {
  it("an annual insurance premium is recurring", () => {
    const first = tx({ merchant: "Insurer", amount: 6000, date: "2024-03-10" });
    const second = tx({ merchant: "Insurer", amount: 6300, date: "2025-03-12" });
    expect(isRecurringCharge(second, [first, second])).toBe(true);
    expect(isRecurringCharge(first, [first, second])).toBe(true);
  });

  it("a one-off car is not recurring", () => {
    const car = tx({ merchant: "Dealer", amount: 30000, date: "2025-06-20" });
    expect(isRecurringCharge(car, [car])).toBe(false);
  });

  it("a big buy at a frequent merchant is not recurring", () => {
    const big = tx({ merchant: "Amazon", amount: 6000, date: "2024-03-10" });
    const small = tx({ merchant: "Amazon", amount: 40, date: "2025-03-10" });
    expect(isRecurringCharge(big, [big, small])).toBe(false);
  });

  it("does not count the charge as evidence of itself, by id or by identity", () => {
    const a = tx({ merchant: "Insurer", amount: 6000, date: "2024-03-10" });
    expect(isRecurringCharge(a, [a])).toBe(false);
    // A copy with the same id is the same transaction, not a repeat of it.
    expect(isRecurringCharge(a, [{ ...a }])).toBe(false);
  });

  it("falls back to object identity when ids are blank", () => {
    const a = tx({ id: "", merchant: "Insurer", amount: 6000, date: "2024-03-10" });
    const b = tx({ id: "", merchant: "Insurer", amount: 6000, date: "2025-03-10" });
    expect(isRecurringCharge(a, [a])).toBe(false);
    expect(isRecurringCharge(a, [a, b])).toBe(true);
  });

  it("needs the same merchant, matched case-insensitively", () => {
    const a = tx({ merchant: "Insurer", amount: 6000, date: "2024-03-10" });
    expect(isRecurringCharge(a, [a, tx({ merchant: "Other Co", amount: 6000, date: "2025-03-10" })])).toBe(false);
    expect(isRecurringCharge(a, [a, tx({ merchant: " INSURER ", amount: 6000, date: "2025-03-10" })])).toBe(true);
  });

  it("needs an amount within 25% of this charge's", () => {
    const a = tx({ merchant: "Insurer", amount: 1000, date: "2024-03-10" });
    expect(isRecurringCharge(a, [a, tx({ merchant: "Insurer", amount: 1250, date: "2025-03-10" })])).toBe(true);
    expect(isRecurringCharge(a, [a, tx({ merchant: "Insurer", amount: 750, date: "2025-03-10" })])).toBe(true);
    expect(isRecurringCharge(a, [a, tx({ merchant: "Insurer", amount: 1260, date: "2025-03-10" })])).toBe(false);
    expect(isRecurringCharge(a, [a, tx({ merchant: "Insurer", amount: 740, date: "2025-03-10" })])).toBe(false);
  });

  it("needs the repeat to be 25 to 400 days away", () => {
    const a = tx({ merchant: "Insurer", amount: 6000, date: "2024-03-10" });
    const repeat = (date: string) => tx({ merchant: "Insurer", amount: 6000, date });
    // Two buys inside one month are a shopping spree, not a bill.
    expect(isRecurringCharge(a, [a, repeat("2024-03-20")])).toBe(false);
    expect(isRecurringCharge(a, [a, repeat("2025-04-14")])).toBe(true); // 400 days
    expect(isRecurringCharge(a, [a, repeat("2025-04-15")])).toBe(false); // 401 days
  });

  it("counts days on calendar dates, so a daylight-saving change cannot move the 25-day edge", () => {
    const a = tx({ merchant: "Insurer", amount: 6000, date: "2025-03-01" });
    const repeat = (date: string) => tx({ merchant: "Insurer", amount: 6000, date });
    // The US clocks go forward on 2025-03-09, between these dates.
    expect(isRecurringCharge(a, [a, repeat("2025-03-26")])).toBe(true); // 25 days
    expect(isRecurringCharge(a, [a, repeat("2025-03-25")])).toBe(false); // 24 days
  });

  it("looks both backward and forward in time", () => {
    const a = tx({ merchant: "Insurer", amount: 6000, date: "2025-03-10" });
    const earlier = tx({ merchant: "Insurer", amount: 6000, date: "2024-03-10" });
    expect(isRecurringCharge(a, [a, earlier])).toBe(true);
  });

  it("ignores a repeat that is not an expense", () => {
    const a = tx({ merchant: "Insurer", amount: 6000, date: "2024-03-10" });
    const refund = tx({ merchant: "Insurer", amount: 6000, date: "2025-03-10", type: "income" });
    expect(isRecurringCharge(a, [a, refund])).toBe(false);
  });
});

describe("computeSpendingBaseline", () => {
  it("exposes the thresholds the decision record cites", () => {
    expect(BIG_PURCHASE_THRESHOLD).toBe(5000);
    expect(BIG_PURCHASE_LIFE_YEARS).toBe(10);
  });

  it("keeps a big monthly rent in regular spending", () => {
    const cpi = flatCpi("2025-11", "2026-10");
    const result = computeSpendingBaseline(monthly("2025-11", "2026-09", 5500, "Landlord"), OCT_15_2026, cpi, 0);
    expect(result).not.toBeNull();
    expect(result!.amortized).toEqual([]);
    expect(result!.regularAnnual).toBe(66000);
    expect(result!.amortizedAnnual).toBe(0);
    expect(result!.annualSpending).toBe(66000);
  });

  it("amortizes a car over ten years", () => {
    const cpi = flatCpi("2024-10", "2026-10");
    const car = tx({ merchant: "Dealer", description: "Used car", amount: 30000, date: "2025-06-20" });
    const result = computeSpendingBaseline([...monthly("2024-10", "2026-10", 3000, "Landlord"), car], OCT_15_2026, cpi, 0);
    expect(result).not.toBeNull();
    expect(result!.fromMonth).toBe("2024-11");
    expect(result!.toMonth).toBe("2026-09");
    expect(result!.months).toBe(23);
    expect(result!.cpiThrough).toBe("2026-10");
    expect(result!.regularAnnual).toBe(36000);
    expect(result!.amortizedAnnual).toBe(3000);
    expect(result!.annualSpending).toBe(39000);
    expect(result!.amortized).toEqual([
      { date: "2025-06-20", description: "Used car", amount: 30000, realAmount: 30000, annualized: 3000 },
    ]);
  });

  it("restates old months in today's dollars", () => {
    const cpi = linearCpi("2025-01", 100, "2026-10", 110);
    const dealer = tx({ merchant: "Dealer", description: "Used car", amount: 10000, date: "2025-01-01" });
    const result = computeSpendingBaseline([dealer], OCT_15_2026, cpi, 0);
    expect(result).not.toBeNull();
    // On the 1st, so January stays in the window: 2025-01 through 2026-09.
    expect(result!.fromMonth).toBe("2025-01");
    expect(result!.months).toBe(21);
    expect(result!.amortized).toHaveLength(1);
    expect(result!.amortized[0].amount).toBe(10000);
    expect(result!.amortized[0].realAmount).toBe(11000);
    expect(result!.amortized[0].annualized).toBe(1100);
  });

  it("restates regular spending too, month by month", () => {
    // Prices rise 10% over the window: a $1,000 January bill is $1,100 today.
    const cpi = linearCpi("2025-01", 100, "2026-10", 110);
    const result = computeSpendingBaseline(
      [tx({ merchant: "Grocer", amount: 1000, date: "2025-01-01" }), tx({ merchant: "Grocer", amount: 1000, date: "2026-09-01" })],
      OCT_15_2026,
      cpi,
      0,
    );
    expect(result).not.toBeNull();
    // 2025-01 factor 1.1; 2026-09 factor 110 / (100 + 10 × 20/21) ≈ 1.0043.
    const expected = (((1000 * 110) / 100 + (1000 * 110) / (100 + (10 * 20) / 21)) / 21) * 12;
    expect(result!.regularAnnual).toBeCloseTo(expected, 2);
  });

  it("extends the table past its last month at the profile's inflation rate", () => {
    // A table ending in 2026-04 and asOf in 2026-10: six months at 4% a year.
    const cpi = flatCpi("2025-01", "2026-04");
    const result = computeSpendingBaseline(
      [tx({ merchant: "Grocer", amount: 1200, date: "2025-01-01" })],
      OCT_15_2026,
      cpi,
      4,
    );
    expect(result).not.toBeNull();
    expect(result!.cpiThrough).toBe("2026-04");
    // 1200 restated by 1.04^(6/12), spread over 21 months.
    expect(result!.regularAnnual).toBeCloseTo(((1200 * Math.pow(1.04, 0.5)) / 21) * 12, 2);
  });

  it("excludes the current partial month", () => {
    const cpi = flatCpi("2024-10", "2026-10");
    const base = monthly("2024-10", "2026-09", 3000, "Landlord");
    const without = computeSpendingBaseline(base, OCT_15_2026, cpi, 0);
    const withPartial = computeSpendingBaseline(
      [...base, tx({ merchant: "Boat Yard", amount: 10000, date: "2026-10-02" })],
      OCT_15_2026,
      cpi,
      0,
    );
    expect(without).not.toBeNull();
    expect(withPartial).toEqual(without);
  });

  it("ignores transfers and income", () => {
    const cpi = flatCpi("2024-10", "2026-10");
    const base = monthly("2024-10", "2026-10", 3000, "Landlord");
    const without = computeSpendingBaseline(base, OCT_15_2026, cpi, 0);
    const withNoise = computeSpendingBaseline(
      [
        ...base,
        // Both would be "big" and, as income, would also move the earliest month if counted.
        tx({ merchant: "Employer", amount: 9000, date: "2024-01-01", type: "income" }),
        tx({ merchant: "Brokerage", amount: 20000, date: "2024-01-01", type: "transfer" }),
        tx({ merchant: "Brokerage", amount: 20000, date: "2025-05-05", type: "transfer" }),
      ],
      OCT_15_2026,
      cpi,
      0,
    );
    expect(without).not.toBeNull();
    expect(withNoise).toEqual(without);
  });

  it("returns null with no expenses", () => {
    const cpi = flatCpi("2024-10", "2026-10");
    expect(computeSpendingBaseline([], OCT_15_2026, cpi, 0)).toBeNull();
    expect(
      computeSpendingBaseline([tx({ type: "income", amount: 5000, date: "2025-01-10" })], OCT_15_2026, cpi, 0),
    ).toBeNull();
  });

  it("returns null when every expense falls in the current month", () => {
    const cpi = flatCpi("2026-01", "2026-10");
    expect(computeSpendingBaseline([tx({ date: "2026-10-01" })], OCT_15_2026, cpi, 0)).toBeNull();
  });

  it("starts the window the month after a first expense that isn't on the 1st", () => {
    const cpi = flatCpi("2025-01", "2026-10");
    const result = computeSpendingBaseline(
      [tx({ amount: 100, date: "2025-03-02" }), tx({ amount: 100, date: "2025-04-10" })],
      OCT_15_2026,
      cpi,
      0,
    );
    expect(result).not.toBeNull();
    expect(result!.fromMonth).toBe("2025-04");
    expect(result!.toMonth).toBe("2026-09");
    expect(result!.months).toBe(18);
    // The partial first month is dropped, so only the April charge is averaged.
    expect(result!.regularAnnual).toBe(66.67);
  });

  it("keeps a single complete month rather than dropping it to nothing", () => {
    // The only history is a partial September; dropping it would leave no month.
    const cpi = flatCpi("2026-01", "2026-10");
    const result = computeSpendingBaseline([tx({ amount: 400, date: "2026-09-05" })], OCT_15_2026, cpi, 0);
    expect(result).not.toBeNull();
    expect(result!.fromMonth).toBe("2026-09");
    expect(result!.toMonth).toBe("2026-09");
    expect(result!.months).toBe(1);
    expect(result!.annualSpending).toBe(4800);
  });

  it("counts months with no spending in the average", () => {
    const cpi = flatCpi("2025-01", "2026-10");
    const result = computeSpendingBaseline(
      [tx({ amount: 1200, date: "2025-01-01" })],
      OCT_15_2026,
      cpi,
      0,
    );
    expect(result).not.toBeNull();
    // 21 months in the window, one with spend: 1200 / 21 × 12.
    expect(result!.months).toBe(21);
    expect(result!.regularAnnual).toBe(685.71);
  });

  it("finds the month before asOf across a year boundary", () => {
    const cpi = flatCpi("2024-01", "2026-01");
    const result = computeSpendingBaseline(
      [tx({ amount: 100, date: "2025-11-01" })],
      new Date(2026, 0, 10),
      cpi,
      0,
    );
    expect(result).not.toBeNull();
    expect(result!.fromMonth).toBe("2025-11");
    expect(result!.toMonth).toBe("2025-12");
    expect(result!.months).toBe(2);
  });

  it("uses expenses outside the window as evidence that a bill recurs", () => {
    // Each premium below has a twin outside the averaged months: A's first is
    // in the dropped partial first month, B's second is in asOf's partial
    // month. The twins still show the charge is a bill, not a one-off to
    // amortize.
    const cpi = flatCpi("2025-01", "2026-10");
    const result = computeSpendingBaseline(
      [
        tx({ merchant: "Insurer A", amount: 6000, date: "2025-01-04" }),
        tx({ merchant: "Insurer A", amount: 6000, date: "2026-01-04" }),
        tx({ merchant: "Insurer B", amount: 6000, date: "2025-10-04" }),
        tx({ merchant: "Insurer B", amount: 6000, date: "2026-10-04" }),
      ],
      OCT_15_2026,
      cpi,
      0,
    );
    expect(result).not.toBeNull();
    expect(result!.fromMonth).toBe("2025-02");
    expect(result!.months).toBe(20);
    expect(result!.amortized).toEqual([]);
    // Two $6,000 premiums over 20 months, annualized.
    expect(result!.regularAnnual).toBe(7200);
  });

  it("amortizes a purchase over the window itself once the window is longer than ten years", () => {
    // 12 years of history: spreading over max(window, 10 years) is the plain average.
    const cpi = flatCpi("2014-01", "2026-10");
    const car = tx({ merchant: "Dealer", description: "Used car", amount: 24000, date: "2016-05-20" });
    const result = computeSpendingBaseline(
      [tx({ merchant: "Grocer", amount: 100, date: "2014-01-01" }), car],
      OCT_15_2026,
      cpi,
      0,
    );
    expect(result).not.toBeNull();
    expect(result!.months).toBe(153);
    expect(result!.amortized[0].annualized).toBe(Math.round((24000 / (153 / 12)) * 100) / 100);
  });

  it("lists amortized purchases oldest first", () => {
    const cpi = flatCpi("2024-01", "2026-10");
    const late = tx({ merchant: "Dealer", description: "Second car", amount: 20000, date: "2026-02-10" });
    const early = tx({ merchant: "Roofer", description: "New roof", amount: 12000, date: "2024-08-10" });
    const result = computeSpendingBaseline(
      [tx({ amount: 50, date: "2024-01-01" }), late, early],
      OCT_15_2026,
      cpi,
      0,
    );
    expect(result).not.toBeNull();
    expect(result!.amortized.map((p) => p.description)).toEqual(["New roof", "Second car"]);
    // The parts add up to the whole, to the cent.
    expect(result!.annualSpending).toBe(
      Math.round((result!.regularAnnual + result!.amortizedAnnual) * 100) / 100,
    );
  });
});
