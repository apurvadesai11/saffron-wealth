// The one money-rounding convention. Pure — no DB, no React.
//
// Money is Decimal(14,2) in Postgres and a JS `number` across the wire, so
// every total is a float sum of values that were exact in the database. Summing
// ~30 of them can land a fraction of a cent off true (0.1 + 0.2 is
// 0.30000000000000004), and money is displayed to the cent.
//
// This existed inline in computeNetWorthSeries, with the reasoning below, while
// computeNetWorth and groupAccountsByBucket summed floats with no rounding at
// all — so the chart's last point and the summary card could disagree by a
// rounding step on the same data. One function, so the convention cannot drift
// again.

/**
 * Snap a money total to the cent.
 *
 * The `|| 0` is load-bearing: when the true total is $0.00 and the float dust
 * lands negative (0.3 - 0.1 - 0.2), Math.round produces -0, which
 * Intl.NumberFormat renders as "-$0.00" and which Object.is treats as distinct
 * from 0.
 */
export function roundToCent(value: number): number {
  return Math.round(value * 100) / 100 || 0;
}

// The one display convention for dollars, for the same reason: every screen
// hand-rolled `$${n.toFixed(2)}`, which has no thousands separators and puts
// the sign inside the symbol ("$-50.00"). The locale is pinned rather than
// left to the runtime so the server render and the browser can't disagree.
//
// signDisplay "negative" drops the minus from anything that rounds to zero,
// so -0 and -0.001 read "$0.00" rather than "-$0.00" — a zero shown as a debt.
const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  signDisplay: "negative",
});
const USD_WHOLE = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
  signDisplay: "negative",
});

/** "$1,234.56", or "$1,235" with `wholeDollars` (budget figures). */
export function formatUsd(value: number, opts: { wholeDollars?: boolean } = {}): string {
  return (opts.wholeDollars ? USD_WHOLE : USD).format(value);
}
