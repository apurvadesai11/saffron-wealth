// Two-pass transform + DB-aware planning for the Monarch "balance history"
// import (Task 5, Phase 3). Mirrors lib/transaction-import.ts's shape: pure
// CSV parsing lives in lib/csv.ts (Task 1), pure row/keyword transforms
// (parseAmount, guessAccountType, NON_ACCOUNT_NAMES) live in
// lib/monarch-transform.ts (Task 2), and this module is the glue that needs
// the whole batch (grouping every row by account, finding the file's max
// date) plus the DB (existing-account resolution, event dedup) that neither
// of those pure modules can see.
//
// `runBalanceHistoryImportPipeline` is called identically by both API route
// modes so preview and commit can never compute a different-shaped summary
// for the same file: preview passes the plain `prisma` client with
// `commit: false`, commit passes a `$transaction` callback's client with
// `commit: true`. The dedup lookup below runs in BOTH modes (it's a read),
// so preview can honestly report how many rows would actually be new — only
// the final `createBalanceHistoryEvents` insert is commit-gated.

import type { Prisma, PrismaClient } from "@prisma/client";
import { parseAmount, guessAccountType, NON_ACCOUNT_NAMES } from "./monarch-transform";
import { getBucketForType, isLiability } from "./account-utils";
import {
  upsertAccountsFromBalanceHistory,
  findExistingBalanceEventDays,
  createBalanceHistoryEvents,
  type BalanceHistoryAccountGroup,
} from "./accounts";
import type { AccountType } from "./types";

export const REQUIRED_BALANCE_HISTORY_COLUMNS = ["Date", "Balance", "Account"];

type ImportDbClient = PrismaClient | Prisma.TransactionClient;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Ruling 5: case-insensitive exact match against Monarch's insurance
// progress-counter rows, which aren't account balances at all.
const NON_ACCOUNT_NAMES_LOWER = new Set(NON_ACCOUNT_NAMES.map((n) => n.toLowerCase()));

// Cloned (not shared) from lib/transaction-import.ts's identical helpers —
// this app's convention (see resolveAccountIds/resolveCategoryIds in
// lib/accounts.ts and lib/categories.ts) is to let each importer own its own
// small row-reading helpers rather than couple two independent pipelines
// through a shared utility that would have to serve both forever.
function buildColumnLookup(header: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const column of header) {
    map.set(column.trim().toLowerCase(), column);
  }
  return map;
}

function cell(row: Record<string, string>, lookup: Map<string, string>, name: string): string {
  const key = lookup.get(name.toLowerCase());
  if (!key) return "";
  return (row[key] ?? "").trim();
}

interface ParsedRow {
  date: string;
  accountName: string;
  rawBalance: number; // signed
}

interface AccountAccumulator {
  name: string;
  lastDate: string;
  finalBalanceSigned: number; // the balance on `lastDate`
  // One entry per (account, date) pair actually seen — see the in-file dedup
  // note in the main loop below for why this can be shorter than the number
  // of raw rows this account contributed.
  rows: { date: string; rawBalance: number }[];
}

export interface BalanceHistoryImportSummary {
  accountsFound: number;
  newAccounts: { name: string; guessedType: AccountType; archived: boolean }[];
  existingAccounts: number;
  eventRows: number;
  // Split against the DB, not just a raw count, so preview is actually
  // honest: re-exporting full history in month 2 should preview close to 0
  // new rows, not the whole file (Task 3's reviewed shape does the same
  // split for transactions — newTransactions/duplicateRows alongside
  // totalRows). A brand-new account's rows are always "new" without a DB
  // round trip, since it has no prior events by construction. Note these
  // two can sum to slightly less than `eventRows` when the file itself
  // contains a same-account-same-day repeat (see the in-file dedup note
  // below) — matching Task 3's own totalRows, which likewise isn't
  // guaranteed to equal newTransactions + duplicateRows.
  newEventRows: number;
  duplicateEventRows: number;
  skippedNonAccountRows: number;
  dateRange: { from: string; to: string };
}

export interface BalanceHistoryImportResult {
  summary: BalanceHistoryImportSummary;
  eventsInserted?: number;
}

export async function runBalanceHistoryImportPipeline(
  client: ImportDbClient,
  userId: string,
  rawRows: Record<string, string>[],
  header: string[],
  opts: { commit: boolean },
): Promise<BalanceHistoryImportResult> {
  const lookup = buildColumnLookup(header);

  // Pass 1: read + drop. A row with an unparseable date/amount or an empty
  // account name is silently dropped (mirrors lib/transaction-import.ts's
  // parseRow precedent) — it's not a real balance. Medical-tracker rows
  // parse fine but aren't accounts at all (Ruling 5), so they get their own
  // counter instead of vanishing indistinguishably into malformed rows.
  const parsed: ParsedRow[] = [];
  let skippedNonAccountRows = 0;

  for (const raw of rawRows) {
    const date = cell(raw, lookup, "date");
    const accountName = cell(raw, lookup, "account");
    const balanceRaw = cell(raw, lookup, "balance");
    if (!DATE_PATTERN.test(date) || accountName.length === 0) continue;

    if (NON_ACCOUNT_NAMES_LOWER.has(accountName.toLowerCase())) {
      skippedNonAccountRows++;
      continue;
    }

    let rawBalance: number;
    try {
      rawBalance = parseAmount(balanceRaw);
    } catch {
      continue;
    }

    parsed.push({ date, accountName, rawBalance });
  }

  // For each (account, date) pair, remember the index of its LAST
  // occurrence in `parsed` — a real Monarch export is one row per account
  // per day, but a hand-edited or re-exported file could carry a revised
  // value for a day it already reported. Without this, both rows would
  // become separate event candidates for the exact same (accountId, asOf)
  // key; since that key has no unique constraint (Ruling 8), both would
  // insert, land in the same createMany batch, and get an IDENTICAL
  // recordedAt — leaving Task 6's asOf-tie tiebreak nothing to prefer
  // between them. Collapsing to the last-in-file value here is the same
  // last-wins rule already used for `lastDate`/`finalBalanceSigned` below.
  const lastIndexForKey = new Map<string, number>();
  parsed.forEach((row, i) => {
    lastIndexForKey.set(`${row.accountName}|${row.date}`, i);
  });

  // Pass 2: group by account. `lastDate`/`finalBalanceSigned` feed Ruling
  // 3's archive check and Ruling 4's sign-aware type guess; `rows` (deduped
  // per the note above) feeds the event log below, once each account's
  // FINAL resolved type is known.
  const accountsByName = new Map<string, AccountAccumulator>();
  const accountNamesOrdered: string[] = [];
  let fileMinDate = "";
  let fileMaxDate = "";

  for (let i = 0; i < parsed.length; i++) {
    const row = parsed[i];
    if (fileMinDate === "" || row.date < fileMinDate) fileMinDate = row.date;
    if (fileMaxDate === "" || row.date > fileMaxDate) fileMaxDate = row.date;

    let acc = accountsByName.get(row.accountName);
    if (!acc) {
      acc = { name: row.accountName, lastDate: row.date, finalBalanceSigned: row.rawBalance, rows: [] };
      accountsByName.set(row.accountName, acc);
      accountNamesOrdered.push(row.accountName);
    }
    // >= so that, within a same-day tie for an account's latest date, the
    // last-encountered row in file order wins. Real exports are one row per
    // account per day, so this tiebreak only matters for adversarial or
    // hand-edited input — but it needs to be *some* deterministic rule.
    if (row.date >= acc.lastDate) {
      acc.lastDate = row.date;
      acc.finalBalanceSigned = row.rawBalance;
    }
    // Only the winning (last-in-file) row for this (account, date) pair
    // becomes an event candidate.
    if (lastIndexForKey.get(`${row.accountName}|${row.date}`) === i) {
      acc.rows.push({ date: row.date, rawBalance: row.rawBalance });
    }
  }

  const groups: BalanceHistoryAccountGroup[] = accountNamesOrdered.map((name) => {
    const acc = accountsByName.get(name)!;
    return { name: acc.name, lastDate: acc.lastDate, finalBalanceSigned: acc.finalBalanceSigned };
  });

  // Read-only when !opts.commit — upsertAccountsFromBalanceHistory only
  // creates/updates rows when told to write, so preview can report exactly
  // what commit would do without ever mutating anything.
  const resolved = await upsertAccountsFromBalanceHistory(userId, groups, fileMaxDate, client, opts.commit);
  const resolvedByName = new Map(resolved.map((r) => [r.name, r]));

  // Sign-adjust every surviving row using the account's FINAL resolved
  // type, not just its type going in — a re-typed account (Ruling 7) needs
  // its whole history stored under the new sign convention, or older rows
  // would keep the wrong one even though the account itself no longer does.
  const eventCandidates: { accountId: string | null; asOf: string; balance: number; isNewAccount: boolean }[] = [];
  for (const name of accountNamesOrdered) {
    const acc = accountsByName.get(name)!;
    const res = resolvedByName.get(name)!;
    const isDebt = isLiability(getBucketForType(res.finalType));
    for (const row of acc.rows) {
      eventCandidates.push({
        accountId: res.accountId,
        asOf: row.date,
        // Debt-bucket history is NEGATED, not abs'd: Monarch's raw balance
        // for a debt account is already signed as "amount owed" (negative
        // = owed, positive = a credit/overpayment) — negating preserves
        // that sign exactly, so a rare overpaid-card day correctly becomes
        // a NEGATIVE amount-owed instead of collapsing to the same
        // magnitude as an ordinary owed-money day. This is deliberately
        // asymmetric with Account.balance in lib/accounts.ts, which stays
        // on its abs+clamp path — see the comment there for why.
        balance: isDebt ? -row.rawBalance : row.rawBalance,
        isNewAccount: res.isNew,
      });
    }
  }

  // Dedup against the DB only matters for accounts that already existed
  // before this import — a brand-new account can't have prior events by
  // construction, so its rows are new without a lookup. Running this in
  // BOTH modes (not just commit) is what makes preview honest: existing
  // accounts already carry a real `accountId` in preview mode too (only a
  // brand-new account's id is null there), so there's no structural reason
  // to skip this read on the preview path.
  const existingAccountIds = [
    ...new Set(
      eventCandidates.filter((c) => !c.isNewAccount && c.accountId !== null).map((c) => c.accountId as string),
    ),
  ];
  const existingDays = await findExistingBalanceEventDays(userId, existingAccountIds, client);

  // NOTE for Task 6: this dedup is presence-only, not value-comparing. If a
  // day already has an event and this import carries a REVISED balance for
  // that same day, the revision is silently dropped — the existing (stale)
  // value is what stays in history. There is currently no way to
  // re-import a corrected historical balance short of deleting the event
  // row directly.
  let newEventRows = 0;
  let duplicateEventRows = 0;
  const newEvents: { accountId: string; asOf: string; balance: number }[] = [];
  for (const c of eventCandidates) {
    const isDuplicate = !c.isNewAccount && c.accountId !== null && existingDays.has(`${c.accountId}|${c.asOf}`);
    if (isDuplicate) {
      duplicateEventRows++;
      continue;
    }
    newEventRows++;
    // accountId is only null for a brand-new account in preview mode, where
    // nothing gets inserted anyway (guarded by opts.commit below).
    if (c.accountId !== null) {
      newEvents.push({ accountId: c.accountId, asOf: c.asOf, balance: c.balance });
    }
  }

  const summary: BalanceHistoryImportSummary = {
    accountsFound: groups.length,
    newAccounts: resolved
      .filter((r) => r.isNew)
      .map((r) => ({ name: r.name, guessedType: r.finalType, archived: r.archived })),
    existingAccounts: resolved.filter((r) => !r.isNew).length,
    eventRows: parsed.length,
    newEventRows,
    duplicateEventRows,
    skippedNonAccountRows,
    dateRange: { from: fileMinDate, to: fileMaxDate },
  };

  if (!opts.commit) {
    return { summary };
  }

  const eventsInserted = await createBalanceHistoryEvents(userId, newEvents, client);

  return { summary, eventsInserted };
}
