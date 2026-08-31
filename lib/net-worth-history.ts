// Net-worth-over-time series math (Phase 3). Pure — no Prisma, no fetch, no
// React. Task 8's server-side caller queries AccountBalanceEvent, converts
// Decimal/Date columns to number/"YYYY-MM-DD" strings, and calls this with
// plain objects; the client then slices the returned MAX series by range.
//
// Ruling 3 — the rule this whole file exists to get right: an account's
// contribution window starts at firstDate (never before it existed) and, for
// an ARCHIVED account, closes before its archive date too. Real imported
// history has accounts that stop reporting while frozen at a large non-zero
// balance (a mortgage paid off, an ESPP liquidated) — reading "most recent
// event <= D" with no upper bound would carry that frozen balance into every
// later sample date, including today, i.e. a phantom mortgage in the CURRENT
// net worth. Task 5 archives exactly those accounts, so gating the upper
// bound closes their window and zeroes them out today.
//
// Amendment (Task 8 review finding): the upper bound is
// min(lastDate, dayBefore(archivedAt)), not lastDate alone. archiveAccount
// (lib/accounts.ts) never writes a closing AccountBalanceEvent, so an
// account created and archived on the SAME calendar day has lastDate equal
// to its own archive date — "date > lastDate" alone doesn't exclude that
// day, so the series would still count it on the very day the live summary
// card (computeNetWorth, via listAccounts) already excludes it
// unconditionally. Comparing directly against archivedAt's date closes that
// gap: an archived account contributes on date D iff D >= firstDate && D <=
// lastDate && D < archivedAtDate. In the ordinary case — an account that
// stopped reporting well before a later import archived it — archivedAtDate
// is far later than lastDate, so this min is still just lastDate and the
// mortgage example above is unchanged.
//
// Amendment: an ACTIVE account has no upper bound — its last known balance
// carries forward to the end of the series. This exists because Phase 1's
// createAccount writes exactly one opening-balance event, so a hand-entered
// account's own lastDate is its creation day; closing its window there would
// make it vanish from every later chart point (including "today") while it
// still counts in the live summary card. Carry-forward-inside-the-window
// (for accounts with sparse events) applies regardless of archived state;
// only the "does the window ever end" question depends on it.
//
// Ruling 9 — Task 5's import has no unique constraint on (accountId, asOf):
// Phase 1 legitimately appends a new event on every balance edit, so a user
// changing a balance twice in one day is normal, not a data bug. When two
// events share an asOf, the later recordedAt is the one that should carry.

import { getBucketForType, isLiability } from "./account-utils";
import type { AccountType } from "./types";

export interface NetWorthPoint {
  date: string;
  value: number;
}

interface BalanceEventInput {
  accountId: string;
  asOf: string; // "YYYY-MM-DD"
  balance: number;
  recordedAt: string; // ISO — only its ordering matters here, not its value
}

interface AccountInput {
  id: string;
  type: AccountType;
  archivedAt: string | null;
}

// One account's events reduced to what the sweep needs: the order carry-
// forward should walk them in, and the window derived from that order.
interface AccountSeries {
  liability: boolean;
  // Gates whether the archive-date upper bound below applies at all — see
  // the Ruling 3 amendment above.
  archived: boolean;
  // Date portion ("YYYY-MM-DD") of archivedAt — only meaningful when
  // `archived` is true. This IS compared against sample dates now (Ruling 3
  // amendment); an earlier version of this file claimed the timestamp was
  // "never compared against anything," which was itself the tell that it
  // carried information the logic below was throwing away.
  archivedAtDate: string | null;
  // asOf ascending, tiebroken by recordedAt ascending (Ruling 9) — so for a
  // repeated asOf, the last entry in this array is the one that should win.
  events: { asOf: string; balance: number }[];
  firstDate: string;
  lastDate: string;
}

export function computeNetWorthSeries(
  events: BalanceEventInput[],
  accounts: AccountInput[],
): NetWorthPoint[] {
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  const eventsByAccount = new Map<string, BalanceEventInput[]>();
  for (const event of events) {
    const bucket = eventsByAccount.get(event.accountId);
    if (bucket) {
      bucket.push(event);
    } else {
      eventsByAccount.set(event.accountId, [event]);
    }
  }

  const series = new Map<string, AccountSeries>();
  const sampleDates = new Set<string>();

  for (const [accountId, accountEvents] of eventsByAccount) {
    const account = accountById.get(accountId);
    // An event whose account isn't in the roster has no type to key the
    // asset/liability taxonomy off of — drop it rather than guess a bucket.
    if (!account) continue;

    // Lexicographic comparison is valid for "YYYY-MM-DD" and avoids building
    // a Date per event in what's otherwise a hot sort.
    const sorted = [...accountEvents].sort((a, b) => {
      if (a.asOf !== b.asOf) return a.asOf < b.asOf ? -1 : 1;
      if (a.recordedAt !== b.recordedAt) return a.recordedAt < b.recordedAt ? -1 : 1;
      return 0;
    });

    for (const e of sorted) sampleDates.add(e.asOf);

    series.set(accountId, {
      liability: isLiability(getBucketForType(account.type)),
      // `!= null` (not `!== null`): the caller hand-maps Prisma's Date | null
      // into this string | null shape, and a runtime `undefined` slipping
      // through that mapping must still read as "active," not "archived" —
      // `!== null` would treat undefined as archived and silently reproduce
      // the exact bug this field exists to prevent, by drawing a LOWER line
      // (a real account dropped from "today") rather than throwing.
      archived: account.archivedAt != null,
      archivedAtDate: account.archivedAt != null ? account.archivedAt.slice(0, 10) : null,
      events: sorted.map((e) => ({ asOf: e.asOf, balance: e.balance })),
      firstDate: sorted[0].asOf,
      lastDate: sorted[sorted.length - 1].asOf,
    });
  }

  const sortedDates = [...sampleDates].sort();

  // Moving index per account, persisted across the date loop below: since
  // sortedDates is ascending, each account's cursor only ever steps forward
  // through its own events and never rescans from the start. That makes the
  // whole sweep O(dates * accounts) with an O(events) amortized cost for the
  // index advances, instead of O(dates * events) re-scanning per date.
  const cursor = new Map<string, number>();
  for (const accountId of series.keys()) cursor.set(accountId, 0);

  const points: NetWorthPoint[] = [];
  for (const date of sortedDates) {
    let total = 0;

    for (const [accountId, acct] of series) {
      if (date < acct.firstDate) continue; // never existed yet — lower bound is unconditional
      // Ruling 3 (amended): an archived account's window closes at
      // min(lastDate, dayBefore(archivedAtDate)) — active accounts have no
      // upper bound and carry forward below. The archivedAtDate half of
      // this OR exists specifically for same-day create-then-archive:
      // archiveAccount never writes a closing event, so lastDate alone can
      // equal today even though the account is already archived as of
      // today, which "date > lastDate" alone would fail to exclude.
      if (acct.archived && (date > acct.lastDate || date >= acct.archivedAtDate!)) continue;

      let idx = cursor.get(accountId)!;
      // Advance while the NEXT event is still on-or-before this date — the
      // last event stepped onto is the carry-forward value for `date`. When
      // several events share an asOf (Ruling 9), this walks through all of
      // them and stops on the last (latest-recordedAt) one.
      while (idx + 1 < acct.events.length && acct.events[idx + 1].asOf <= date) {
        idx++;
      }
      cursor.set(accountId, idx);

      const balance = acct.events[idx].balance;
      total += acct.liability ? -balance : balance;
    }

    // Round once, here, per point — not accumulated across dates (each
    // point is an independent sum of ~30 account balances, not a running
    // total), but summing that many Decimal-turned-number values can still
    // land a fraction of a cent off true due to binary float rounding.
    // Money is displayed to the cent, so snap back to the cent explicitly
    // rather than let e.g. 1234567.9999999998 leak into the chart/tooltip.
    // `|| 0` specifically: when the true total is $0.00 and the float dust
    // lands negative (e.g. 0.3 - 0.1 - 0.2), Math.round produces -0, which
    // Intl.NumberFormat renders as "-$0.00" and which Object.is/toBe treats
    // as distinct from 0.
    points.push({ date, value: Math.round(total * 100) / 100 || 0 });
  }

  return points;
}
