// The annual-spending baseline behind the FIRE number. Pure — no DB, no React.
//
// The whole expense history is averaged, in today's dollars, rather than the
// last year or two: one year is too short to see a car or a roof, and the FI
// number is a multiple of this figure, so whatever noise is in it is multiplied
// by 25 or more. One-off big purchases are spread over their useful life rather
// than counted in the month they happened. The reasoning, and the blind spot of
// the recurrence test, are in docs/decisions/0016-fire-spending-baseline.md.
//
// Month keys ("YYYY-MM") are sliced from the "YYYY-MM-DD" transaction dates and
// never built through a Date, and asOf's month comes from its local calendar
// fields — see docs/decisions/0010-utc-persistence-local-period-math.md.

import { roundToCent } from "./money";
import type { AmortizedPurchase, MonthlyCpi, SpendingBaseline, Transaction } from "./types";

/** A purchase this large (in today's dollars) is a candidate for amortizing. */
export const BIG_PURCHASE_THRESHOLD = 5000;

/** The span a big purchase is spread over: a car or a roof, not a lifetime. */
export const BIG_PURCHASE_LIFE_YEARS = 10;

/**
 * The years a big purchase is spread over for a history of `months`: ten, or
 * the length of the history when that is longer. Exported so the assumptions
 * panel states the life the baseline actually used instead of restating the
 * rule.
 */
export function purchaseLifeYears(months: number): number {
  return Math.max(months / 12, BIG_PURCHASE_LIFE_YEARS);
}

// "Same bill" tolerances for the recurrence test. 25 days is just under the
// shortest real billing cycle, so two buys in one month at one shop don't make
// each other recurring; 400 days is a year with slack for a due date that
// drifts. Amounts must agree because the same merchant is not the same bill.
const RECURRENCE_AMOUNT_TOLERANCE = 0.25;
const RECURRENCE_MIN_DAYS = 25;
const RECURRENCE_MAX_DAYS = 400;

const MS_PER_DAY = 86_400_000;

// A month as a single integer, so month arithmetic never goes through a Date.
// Exported for lib/fire-inputs.ts, which windows income by the same months.
export function monthIndex(month: string): number {
  return Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
}

export function monthFromIndex(index: number): string {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

// Whole days since the epoch for a "YYYY-MM-DD" string. Both sides of a
// distance are built with Date.UTC, so a daylight-saving change can't turn a
// 25-day gap into 24.96 days. The number is the only thing that leaves.
function dayNumber(date: string): number {
  return (
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / MS_PER_DAY
  );
}

// Reads the CPI table as a function of month. The table is not assumed to be
// sorted, and a gap inside it takes the nearest earlier month's level, so a
// hole in the data can't turn into NaN dollars.
function readCpi(cpi: MonthlyCpi[], inflationPct: number) {
  if (cpi.length === 0) {
    throw new Error("The CPI table is empty, so there is nothing to restate dollars with.");
  }
  const byIndex = new Map<number, number>();
  let first = cpi[0];
  let last = cpi[0];
  for (const row of cpi) {
    byIndex.set(monthIndex(row.month), row.cpi);
    if (row.month < first.month) first = row;
    if (row.month > last.month) last = row;
  }
  const firstIndex = monthIndex(first.month);
  const lastIndex = monthIndex(last.month);
  const growth = 1 + inflationPct / 100;

  function at(month: string): number {
    const index = monthIndex(month);
    // Before the table there is nothing to measure against, so hold its first
    // level. Past it (the latest months aren't published yet), carry the last
    // level forward at the profile's inflation assumption.
    if (index <= firstIndex) return first.cpi;
    if (index > lastIndex) return last.cpi * Math.pow(growth, (index - lastIndex) / 12);
    for (let i = index; i > firstIndex; i--) {
      const level = byIndex.get(i);
      if (level !== undefined) return level;
    }
    return first.cpi;
  }

  return { at, lastMonth: last.month };
}

/**
 * How many of `toMonth`'s dollars a `fromMonth` dollar is worth: `CPI(to) /
 * CPI(from)`, so multiplying an old amount by it restates it in today's money.
 */
export function cpiFactor(fromMonth: string, toMonth: string, cpi: MonthlyCpi[], inflationPct: number): number {
  const { at } = readCpi(cpi, inflationPct);
  return at(toMonth) / at(fromMonth);
}

/** What identifies the payee: the merchant, or the description when there isn't one. */
export function merchantKey(t: Pick<Transaction, "merchant" | "description">): string {
  return (t.merchant ?? t.description).trim().toLowerCase();
}

// The same transaction by id, or by identity when ids are blank — a blank id
// must not make every transaction equal to every other.
function isSameTransaction(a: Transaction, b: Transaction): boolean {
  return a === b || (Boolean(a.id) && a.id === b.id);
}

/**
 * Whether `t` is one payment of a bill that comes round again: some *other*
 * expense at the same merchant, for a similar amount, 25 to 400 days away.
 * That covers monthly through annual bills. `expenses` may include `t`; it is
 * never taken as evidence of itself.
 *
 * "Similar" is within 25% of the larger of the two amounts, so a pair is
 * recurring from both sides or from neither.
 */
export function isRecurringCharge(t: Transaction, expenses: Transaction[]): boolean {
  const key = merchantKey(t);
  const day = dayNumber(t.date);
  return expenses.some((other) => {
    if (other.type !== "expense" || isSameTransaction(other, t)) return false;
    if (merchantKey(other) !== key) return false;
    const tolerance = Math.max(t.amount, other.amount) * RECURRENCE_AMOUNT_TOLERANCE;
    if (Math.abs(other.amount - t.amount) > tolerance) return false;
    const apart = Math.abs(dayNumber(other.date) - day);
    return apart >= RECURRENCE_MIN_DAYS && apart <= RECURRENCE_MAX_DAYS;
  });
}

/**
 * Annual spending in today's dollars from the full expense history, or null
 * when there is no complete month to average.
 *
 * The window is complete calendar months only. `toMonth` is the month before
 * `asOf`'s (the current one is partial). `fromMonth` is the month after the
 * earliest expense's, because an import rarely starts on the 1st and a
 * part-month would understate spending — unless the earliest expense is on the
 * 1st, or dropping its month would leave nothing, in which case that month is
 * kept. Months with no spend count in the average.
 *
 * Expenses outside the window (the dropped first month, the current month)
 * still count as evidence that a charge recurs; they just aren't averaged.
 */
export function computeSpendingBaseline(
  transactions: Transaction[],
  asOf: Date,
  cpi: MonthlyCpi[],
  inflationPct: number,
): SpendingBaseline | null {
  const expenses = transactions.filter((t) => t.type === "expense");
  if (expenses.length === 0) return null;

  let earliest = expenses[0].date;
  for (const t of expenses) if (t.date < earliest) earliest = t.date;
  const earliestMonth = earliest.slice(0, 7);

  const asOfIndex = asOf.getFullYear() * 12 + asOf.getMonth();
  const asOfMonth = monthFromIndex(asOfIndex);
  const toMonth = monthFromIndex(asOfIndex - 1);

  const startsOnFirst = earliest.slice(8, 10) === "01";
  const monthAfterEarliest = monthFromIndex(monthIndex(earliestMonth) + 1);
  const fromMonth = startsOnFirst || monthAfterEarliest > toMonth ? earliestMonth : monthAfterEarliest;
  if (fromMonth > toMonth) return null;

  const months = monthIndex(toMonth) - monthIndex(fromMonth) + 1;
  const { at, lastMonth } = readCpi(cpi, inflationPct);
  const asOfLevel = at(asOfMonth);

  // Recurrence only ever compares like merchants, so hand each charge its own
  // merchant's expenses rather than the whole history.
  const byMerchant = new Map<string, Transaction[]>();
  for (const t of expenses) {
    const key = merchantKey(t);
    const group = byMerchant.get(key);
    if (group) group.push(t);
    else byMerchant.set(key, [t]);
  }

  const factorByMonth = new Map<string, number>();
  const lifeYears = purchaseLifeYears(months);
  let regularTotal = 0;
  const amortized: AmortizedPurchase[] = [];

  for (const t of expenses) {
    const month = t.date.slice(0, 7);
    if (month < fromMonth || month > toMonth) continue;

    let factor = factorByMonth.get(month);
    if (factor === undefined) {
      factor = asOfLevel / at(month);
      factorByMonth.set(month, factor);
    }
    const real = t.amount * factor;

    const isBig = real >= BIG_PURCHASE_THRESHOLD && !isRecurringCharge(t, byMerchant.get(merchantKey(t)) ?? []);
    if (isBig) {
      amortized.push({
        date: t.date,
        description: t.description,
        amount: t.amount,
        realAmount: roundToCent(real),
        annualized: roundToCent(real / lifeYears),
      });
    } else {
      regularTotal += real;
    }
  }

  amortized.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const regularAnnual = roundToCent((regularTotal / months) * 12);
  // Summed from the rounded rows, so the list on screen adds up to the total.
  const amortizedAnnual = roundToCent(amortized.reduce((sum, p) => sum + p.annualized, 0));

  return {
    annualSpending: roundToCent(regularAnnual + amortizedAnnual),
    regularAnnual,
    amortizedAnnual,
    months,
    fromMonth,
    toMonth,
    cpiThrough: lastMonth,
    amortized,
  };
}
