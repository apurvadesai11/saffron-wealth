// Net-worth-over-time series math. Pure — no Prisma, no fetch, no React. The
// server-side caller queries AccountBalanceEvent, converts Decimal/Date columns
// to number/"YYYY-MM-DD" strings, and calls this with plain objects; the client
// slices the returned MAX series by range.
//
// Three invariants this file exists to get right. The reasoning behind each,
// including what was tried and rejected, is in docs/decisions/:
//
// 1. An account contributes its most recent balance at or before a sample
//    date, and nothing outside its window. The window opens at firstDate; it
//    closes at min(lastDate, dayBefore(archivedAt)) for an archived account
//    and never for an active one.
//    See docs/decisions/0003-account-contribution-window.md.
//
// 2. AccountBalanceEvent.balance IS the account's signed contribution to net
//    worth on that date — negative reduces it. The bucket is applied once, at
//    write time, by whoever wrote the event. This file therefore never reads
//    account.type to decide a sign, so an account that later changes bucket
//    cannot have its existing history retroactively reinterpreted.
//    See docs/decisions/0007-never-retype-an-existing-account.md.
//
// 3. Where two events share an asOf, the later recordedAt wins. There is no
//    unique constraint on (accountId, asOf), by design.
//    See docs/decisions/0009-same-day-events-tiebreak-on-recordedat.md.
//
// An account with no events is omitted entirely rather than contributing zero.

import type { AccountType } from "./types";
import { roundToCent } from "./money";

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
  // Gates whether the archive-date upper bound applies at all.
  archived: boolean;
  // Date portion ("YYYY-MM-DD") of archivedAt, meaningful only when
  // `archived`. Compared directly against sample dates — see invariant 1.
  archivedAtDate: string | null;
  // asOf ascending, tiebroken by recordedAt ascending, so for a repeated asOf
  // the LAST entry here is the one that wins (invariant 3).
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
    // An unclassified account contributes to no total, here for the same
    // reason as in computeNetWorth — and for one more: if the series counted
    // it while the summary card did not, the chart's last point and the card
    // would differ by exactly that account's balance.
    if (account.type === "uncategorized") continue;

    // Lexicographic comparison is valid for "YYYY-MM-DD" and avoids building
    // a Date per event in what's otherwise a hot sort.
    const sorted = [...accountEvents].sort((a, b) => {
      if (a.asOf !== b.asOf) return a.asOf < b.asOf ? -1 : 1;
      if (a.recordedAt !== b.recordedAt) return a.recordedAt < b.recordedAt ? -1 : 1;
      return 0;
    });

    for (const e of sorted) sampleDates.add(e.asOf);

    series.set(accountId, {
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
      // An archived account's window closes at
      // min(lastDate, dayBefore(archivedAtDate)); an active one has no upper
      // bound and carries forward below. The archivedAtDate half of this OR is
      // for same-day create-then-archive, where lastDate alone equals today
      // even though the account is archived as of today (invariant 1).
      if (acct.archived && (date > acct.lastDate || date >= acct.archivedAtDate!)) continue;

      let idx = cursor.get(accountId)!;
      // Advance while the NEXT event is still on-or-before this date; the
      // last event stepped onto is the carry-forward value. Events sharing an
      // asOf are walked through to the last (latest-recordedAt) one
      // (invariant 3).
      while (idx + 1 < acct.events.length && acct.events[idx + 1].asOf <= date) {
        idx++;
      }
      cursor.set(accountId, idx);

      total += acct.events[idx].balance;
    }

    // Round once, here, per point — not accumulated across dates: each point
    // is an independent sum of ~30 account balances, not a running total.
    // The convention and the reasoning behind the -0 guard live in
    // lib/money.ts, shared with computeNetWorth so the chart's last point and
    // the summary card cannot drift apart.
    points.push({ date, value: roundToCent(total) });
  }

  return points;
}
