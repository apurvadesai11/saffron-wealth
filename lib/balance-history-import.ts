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
// `commit: false` (read-only — see the early return below, which happens
// before any write-shaped call is even reachable), commit passes a
// `$transaction` callback's client with `commit: true`.

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
  firstDate: string;
  lastDate: string;
  finalBalanceSigned: number; // the balance on `lastDate`
  rows: { date: string; rawBalance: number }[];
}

export interface BalanceHistoryImportSummary {
  accountsFound: number;
  newAccounts: { name: string; guessedType: AccountType; archived: boolean }[];
  existingAccounts: number;
  eventRows: number;
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

  // Pass 2: group by account (firstDate/lastDate/finalBalanceSigned feed
  // Ruling 3's archive check and Ruling 4's sign-aware type guess) while
  // also keeping every row so its balance can be sign-adjusted for the
  // event log below, once each account's FINAL resolved type is known.
  const accountsByName = new Map<string, AccountAccumulator>();
  const accountNamesOrdered: string[] = [];
  let fileMinDate = "";
  let fileMaxDate = "";

  for (const row of parsed) {
    if (fileMinDate === "" || row.date < fileMinDate) fileMinDate = row.date;
    if (fileMaxDate === "" || row.date > fileMaxDate) fileMaxDate = row.date;

    let acc = accountsByName.get(row.accountName);
    if (!acc) {
      acc = {
        name: row.accountName,
        firstDate: row.date,
        lastDate: row.date,
        finalBalanceSigned: row.rawBalance,
        rows: [],
      };
      accountsByName.set(row.accountName, acc);
      accountNamesOrdered.push(row.accountName);
    }
    if (row.date < acc.firstDate) acc.firstDate = row.date;
    // >= so that, within a same-day tie for an account's latest date, the
    // last-encountered row in file order wins. Real exports are one row per
    // account per day, so this tiebreak only matters for adversarial or
    // hand-edited input — but it needs to be *some* deterministic rule.
    if (row.date >= acc.lastDate) {
      acc.lastDate = row.date;
      acc.finalBalanceSigned = row.rawBalance;
    }
    acc.rows.push({ date: row.date, rawBalance: row.rawBalance });
  }

  const groups: BalanceHistoryAccountGroup[] = accountNamesOrdered.map((name) => {
    const acc = accountsByName.get(name)!;
    return {
      name: acc.name,
      firstDate: acc.firstDate,
      lastDate: acc.lastDate,
      finalBalanceSigned: acc.finalBalanceSigned,
    };
  });

  // Read-only when !opts.commit — upsertAccountsFromBalanceHistory only
  // creates/updates rows when told to write, so preview can report exactly
  // what commit would do without ever mutating anything.
  const resolved = await upsertAccountsFromBalanceHistory(userId, groups, fileMaxDate, client, opts.commit);
  const resolvedByName = new Map(resolved.map((r) => [r.name, r]));

  const summary: BalanceHistoryImportSummary = {
    accountsFound: groups.length,
    newAccounts: resolved
      .filter((r) => r.isNew)
      .map((r) => ({ name: r.name, guessedType: r.finalType, archived: r.archived })),
    existingAccounts: resolved.filter((r) => !r.isNew).length,
    eventRows: parsed.length,
    skippedNonAccountRows,
    dateRange: { from: fileMinDate, to: fileMaxDate },
  };

  if (!opts.commit) {
    return { summary };
  }

  // Sign-adjust every retained row using the account's FINAL resolved type,
  // not just its type going in — a re-typed account (Ruling 7) needs its
  // whole history stored under the new sign convention, or older rows would
  // keep the wrong one even though the account itself no longer does.
  const eventCandidates: { accountId: string; asOf: string; balance: number }[] = [];
  for (const name of accountNamesOrdered) {
    const acc = accountsByName.get(name)!;
    const res = resolvedByName.get(name)!;
    // Always set once opts.commit is true: upsertAccountsFromBalanceHistory
    // only returns a null accountId in its read-only (preview) mode.
    const accountId = res.accountId!;
    const isDebt = isLiability(getBucketForType(res.finalType));
    for (const row of acc.rows) {
      eventCandidates.push({
        accountId,
        asOf: row.date,
        balance: isDebt ? Math.abs(row.rawBalance) : row.rawBalance,
      });
    }
  }

  const affectedAccountIds = [...new Set(eventCandidates.map((c) => c.accountId))];
  const existingDays = await findExistingBalanceEventDays(userId, affectedAccountIds, client);
  const newEvents = eventCandidates.filter((c) => !existingDays.has(`${c.accountId}|${c.asOf}`));

  const eventsInserted = await createBalanceHistoryEvents(userId, newEvents, client);

  return { summary, eventsInserted };
}
