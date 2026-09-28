// UTC-safe conversions between a "YYYY-MM-DD" string and a Date.
//
// The columns these feed — Transaction.date, Account.balanceAsOf,
// AccountBalanceEvent.asOf — are all `@db.Date`, with no time component. The
// value has to land on the exact calendar day the string names, and
// `new Date(y, m, d)` builds *local* midnight, which is the previous calendar
// day once serialized in any negative-UTC-offset timezone. Doing the
// arithmetic in UTC on both the read and the write path sidesteps that.
//
// Note the deliberate boundary here: this is the persistence and query layer's
// convention. Period and calendar math in lib/budget-utils.ts is local-time on
// purpose (see parseLocalDate there), because a budget month is whatever month
// the user is standing in. "YYYY-MM-DD" strings are the interchange format
// across that boundary. See docs/decisions/ for the full note.

export function dateStringToUtcDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function utcDateToDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}
