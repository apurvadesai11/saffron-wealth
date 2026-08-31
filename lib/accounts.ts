// Server-only query layer for accounts. Every function is scoped to a userId
// and treats {id, userId} as the ownership check — a mismatched id resolves to
// null/false rather than throwing, so callers can map that straight to 404.
import { Prisma, type PrismaClient, type Account as PrismaAccount } from "@prisma/client";
import { prisma } from "./prisma";
import { guessAccountType } from "./monarch-transform";
import { getBucketForType, isLiability } from "./account-utils";
import type { Account, AccountInput, AccountPatch, AccountType } from "./types";

// Mirrors lib/transactions.ts's UTC-safe date <-> string helpers. Both
// Account.balanceAsOf and AccountBalanceEvent.asOf need to land on the exact
// calendar day a CSV row names — `new Date(y, m, d)` (local midnight) risks
// shifting that day in negative-UTC-offset timezones.
function dateStringToUtcDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function utcDateToDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function mapAccount(row: PrismaAccount): Account {
  return {
    id: row.id,
    name: row.name,
    type: row.type as Account["type"],
    institution: row.institution,
    balance: row.balance.toNumber(),
    balanceAsOf: row.balanceAsOf.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listAccounts(userId: string): Promise<Account[]> {
  const rows = await prisma.account.findMany({
    where: { userId, archivedAt: null },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(mapAccount);
}

// The Restore surface's read side (Phase 3, Task 8): every account
// archivedAt has been set on, most-recently-archived first, so the Net
// Worth page can render them in a collapsed group with a way back in.
export async function listArchivedAccounts(userId: string): Promise<Account[]> {
  const rows = await prisma.account.findMany({
    where: { userId, archivedAt: { not: null } },
    orderBy: { archivedAt: "desc" },
  });
  return rows.map(mapAccount);
}

export async function createAccount(userId: string, input: AccountInput): Promise<Account> {
  const balance = new Prisma.Decimal(input.balance);
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.account.create({
      data: {
        userId,
        name: input.name,
        type: input.type,
        institution: input.institution,
        balance,
      },
    });
    await tx.accountBalanceEvent.create({
      data: {
        userId,
        accountId: created.id,
        balance,
      },
    });
    return created;
  });
  return mapAccount(row);
}

export async function updateAccount(
  userId: string,
  id: string,
  patch: AccountPatch,
): Promise<Account | null> {
  // Restore (Phase 3, Task 8) is the one PATCH shape that must find an
  // ARCHIVED row — every other edit only ever targets an active one (an
  // archived account has no other PATCH path; it has to be restored first).
  // Keeping this as a branch on the existing lookup, rather than a separate
  // restoreAccount function, means both cases share the exact same
  // ownership check and Account/AccountBalanceEvent transaction below.
  const isRestore = patch.archivedAt === null;
  const existing = await prisma.account.findFirst({
    where: isRestore ? { id, userId, archivedAt: { not: null } } : { id, userId, archivedAt: null },
  });
  if (!existing) return null;

  const nextBalance =
    patch.balance !== undefined ? new Prisma.Decimal(patch.balance) : undefined;
  const balanceChanged = nextBalance !== undefined && !nextBalance.equals(existing.balance);

  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.account.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.institution !== undefined ? { institution: patch.institution } : {}),
        ...(isRestore ? { archivedAt: null } : {}),
        ...(balanceChanged
          ? { balance: nextBalance, balanceAsOf: new Date() }
          : {}),
      },
    });
    if (balanceChanged) {
      await tx.accountBalanceEvent.create({
        data: {
          userId,
          accountId: id,
          balance: nextBalance!,
        },
      });
    }
    return updated;
  });

  return mapAccount(row);
}

// Soft-delete: marks the account archived (hidden from listAccounts / net
// worth) but keeps its row and balance history for a future net-worth-over-time
// graph. Returns false if the account doesn't exist, isn't owned by userId, or
// is already archived — the route maps false to 404 either way.
export async function archiveAccount(userId: string, id: string): Promise<boolean> {
  const result = await prisma.account.updateMany({
    where: { id, userId, archivedAt: null },
    data: { archivedAt: new Date() },
  });
  return result.count === 1;
}

// Accepts either the singleton client or a $transaction callback's client —
// the Monarch import (Phase 2b) needs the latter so account creation shares
// one transaction with the category writes before it and the transaction
// writes after it.
export type AccountDbClient = PrismaClient | Prisma.TransactionClient;

// Resolves every name to an account id, matching by (userId, name) — Account
// has no DB-level unique constraint on that pair (unlike Category), so the
// match is enforced here in application code. Read-only unless `write` is
// true, mirroring lib/categories.ts's resolveCategoryIds so preview and
// commit share one code path and can never disagree about what's "new".
//
// A matched existing account is NEVER updated: the import has no balance to
// offer (a transaction export carries no balances), so overwriting a type
// the user already corrected would be strictly worse than leaving it alone.
export async function resolveAccountIds(
  userId: string,
  names: string[],
  client: AccountDbClient = prisma,
  write: boolean = false,
): Promise<{ idByName: Map<string, string>; newNames: Set<string> }> {
  const existing = names.length
    ? await client.account.findMany({
        where: { userId, name: { in: names } },
        select: { id: true, name: true },
      })
    : [];
  const idByName = new Map(existing.map((a) => [a.name, a.id]));
  const newNames = new Set(names.filter((n) => !idByName.has(n)));

  if (write) {
    for (const name of names) {
      if (!newNames.has(name)) continue;
      const zero = new Prisma.Decimal(0);
      const created = await client.account.create({
        data: { userId, name, type: guessAccountType(name), balance: zero },
      });
      // Mirrors createAccount's opening-balance event above, so an account
      // that only ever appears in a transaction import still has a starting
      // point for a future net-worth-over-time graph.
      await client.accountBalanceEvent.create({
        data: { userId, accountId: created.id, balance: zero },
      });
      idByName.set(name, created.id);
    }
  }

  return { idByName, newNames };
}

// ── Balance history import (Phase 3, Task 5) ───────────────────────────────
// The global Monarch "balance history" export covers every account in one
// file. Unlike resolveAccountIds above (built for the transaction import,
// which has no balance to offer and so never touches an existing account),
// this import IS the source of a balance, so it deliberately does update
// existing accounts — see upsertAccountsFromBalanceHistory below for exactly
// what it will and won't overwrite.

export interface BalanceHistoryAccountGroup {
  name: string;
  lastDate: string; // "YYYY-MM-DD" — the CSV's last row for this account
  finalBalanceSigned: number; // raw signed balance on lastDate, before abs/clamp
}

export interface ResolvedBalanceHistoryAccount {
  name: string;
  // Only null when write=false (preview) AND the account doesn't exist yet —
  // preview never creates a row, so there's no id to report.
  accountId: string | null;
  isNew: boolean;
  // The type this account will use going forward: freshly guessed for a new
  // account, re-guessed for an existing one whose sign disagreed (Ruling 7),
  // or simply the account's existing type when neither of those applies.
  finalType: AccountType;
  archived: boolean;
}

// Resolves each CSV account group to an Account row: creates ones that don't
// exist, and updates balance/balanceAsOf/archivedAt on ones that do. A
// user-corrected `type` on an existing account survives re-import UNLESS the
// imported balance's sign disagrees with that type's bucket (a debt-bucket
// account with a positive final balance, or an asset-bucket account with a
// negative one) — the institution's sign is ground truth, a keyword guess is
// not (Ruling 7). Read-only unless `write` is true, so preview and commit
// share this exact code path and can never disagree about what's "new" or
// "archived" (mirrors resolveAccountIds/resolveCategoryIds above).
export async function upsertAccountsFromBalanceHistory(
  userId: string,
  groups: BalanceHistoryAccountGroup[],
  fileMaxDate: string,
  client: AccountDbClient = prisma,
  write: boolean = false,
): Promise<ResolvedBalanceHistoryAccount[]> {
  const names = groups.map((g) => g.name);
  // orderBy makes the "most recently created" tiebreak below deterministic.
  // createdAt alone isn't enough — it's @default(now()), and `now()` is
  // constant within a transaction (the same hazard CLAUDE.md documents for
  // Category.sortOrder), so two accounts created in the same transaction
  // would otherwise tie and fall back to whatever order Postgres happened
  // to return. id is a cuid, which is monotonically increasing at creation
  // time, so it's a safe final tiebreaker.
  const existingRows = names.length
    ? await client.account.findMany({
        where: { userId, name: { in: names } },
        select: { id: true, name: true, type: true, archivedAt: true, createdAt: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      })
    : [];

  // Account has no DB-level unique constraint on (userId, name) (see
  // resolveAccountIds's comment above) — if a user already has duplicate-
  // named accounts, the match is ambiguous. Deliberate tiebreak: prefer an
  // active (non-archived) account, and among ties prefer the most recently
  // created one. This is a documented assumption, not a schema fix — adding
  // `@@unique([userId, name])` is explicitly out of scope (existing rows
  // could already violate it, and an archived/active same-name pair is
  // legitimate).
  const existingByName = new Map<string, typeof existingRows>();
  for (const row of existingRows) {
    const list = existingByName.get(row.name);
    if (list) list.push(row);
    else existingByName.set(row.name, [row]);
  }
  function pickExisting(name: string) {
    const rows = existingByName.get(name);
    if (!rows || rows.length === 0) return undefined;
    if (rows.length === 1) return rows[0];
    const active = rows.filter((r) => r.archivedAt === null);
    const pool = active.length > 0 ? active : rows;
    return pool.reduce((newest, r) => (r.createdAt > newest.createdAt ? r : newest));
  }

  // Captured once so every account archived by this import shares one
  // timestamp, rather than a slightly different "now" per row.
  const importedAt = new Date();

  const results: ResolvedBalanceHistoryAccount[] = [];
  for (const group of groups) {
    const existing = pickExisting(group.name);
    const guessedType = guessAccountType(group.name, group.finalBalanceSigned);
    const guessedIsDebt = isLiability(getBucketForType(guessedType));
    // Ruling 3: an account whose last row is older than the file's max date
    // has stopped reporting — Monarch exports daily for every genuinely
    // active account, so this is a reliable "closed" signal. Soft-archive
    // rather than delete so its history still feeds a future graph.
    const archivedByThisImport = group.lastDate < fileMaxDate;
    const balanceAsOf = dateStringToUtcDate(group.lastDate);

    if (!existing) {
      // A live asset balance is never negative (Phase 1's rule); a debt
      // balance is always stored as the positive amount owed. This is
      // DELIBERATELY different from how AccountBalanceEvent.balance is
      // computed for debt accounts in lib/balance-history-import.ts (negated,
      // not abs'd, and never clamped) — Account.balance is Phase 1's live,
      // non-negative "amount owed today" invariant, not a historical record.
      const balance = guessedIsDebt
        ? Math.abs(group.finalBalanceSigned)
        : Math.max(group.finalBalanceSigned, 0);
      // No prior row, so there's no existing archivedAt to protect —
      // this import's own verdict is authoritative for a brand-new account.
      const archivedAtValue = archivedByThisImport ? importedAt : null;
      let accountId: string | null = null;
      if (write) {
        const created = await client.account.create({
          data: {
            userId,
            name: group.name,
            type: guessedType,
            balance: new Prisma.Decimal(balance),
            balanceAsOf,
            archivedAt: archivedAtValue,
          },
        });
        accountId = created.id;
      }
      results.push({
        name: group.name,
        accountId,
        isNew: true,
        finalType: guessedType,
        archived: archivedAtValue !== null,
      });
      continue;
    }

    const existingIsDebt = isLiability(getBucketForType(existing.type as AccountType));
    const signDisagrees =
      (existingIsDebt && group.finalBalanceSigned > 0) || (!existingIsDebt && group.finalBalanceSigned < 0);
    const finalType = signDisagrees ? guessedType : (existing.type as AccountType);
    const finalIsDebt = signDisagrees ? guessedIsDebt : existingIsDebt;
    const balance = finalIsDebt
      ? Math.abs(group.finalBalanceSigned)
      : Math.max(group.finalBalanceSigned, 0);

    // Monotone archiving: this import may ADD an archivedAt (an account
    // whose data newly says "closed"), but must never CLEAR one that's
    // already set. Ruling 3's archival is an inference from data absence;
    // an already-set archivedAt might instead be an explicit user delete
    // (DELETE /api/accounts/[id]), and an inference must never silently
    // override an explicit action — a re-import resurrecting a balance the
    // user deliberately removed is the same class of trust violation as
    // Task 4's resurrected-transaction bug. "Monotone" rather than "never
    // touch on update" specifically so Ruling 3 still fires going forward:
    // an account that closes BETWEEN two imports still gets archived by the
    // second one, it just can never be un-archived by a later one.
    const archivedAtValue = existing.archivedAt ?? (archivedByThisImport ? importedAt : null);

    if (write) {
      await client.account.update({
        where: { id: existing.id },
        data: {
          type: finalType,
          balance: new Prisma.Decimal(balance),
          balanceAsOf,
          archivedAt: archivedAtValue,
        },
      });
    }
    results.push({
      name: group.name,
      accountId: existing.id,
      isNew: false,
      finalType,
      archived: archivedAtValue !== null,
    });
  }

  return results;
}

// Dedup lookup for the balance-history import's event insert: AccountBalanceEvent
// has no unique constraint on (accountId, asOf) (Ruling 8 — Phase 1 legitimately
// writes more than one event for the same account on the same calendar day), so
// "have we already recorded this account on this day" has to be checked in
// application code against a Set built from one query, not left to the DB.
// `userId` is redundant with `accountId` alone (every id already belongs to
// exactly one user) but is required anyway, matching this file's convention
// of scoping every query to {id, userId} rather than id alone.
export async function findExistingBalanceEventDays(
  userId: string,
  accountIds: string[],
  client: AccountDbClient = prisma,
): Promise<Set<string>> {
  if (accountIds.length === 0) return new Set();
  const rows = await client.accountBalanceEvent.findMany({
    where: { userId, accountId: { in: accountIds } },
    select: { accountId: true, asOf: true },
  });
  return new Set(rows.map((r) => `${r.accountId}|${utcDateToDateString(r.asOf)}`));
}

export interface BalanceHistoryEventRow {
  accountId: string;
  asOf: string; // "YYYY-MM-DD" — the CSV row's own Date, never the insert time
  balance: number; // already sign-adjusted by the caller (see runBalanceHistoryImportPipeline)
}

// A full Monarch export is ~34,000 rows — one createMany for all of them
// would be a single oversized statement, and one row at a time would be
// 34,000 round trips. ~5,000 per call is comfortably inside Postgres's
// parameter-count limits while keeping the round-trip count in single digits.
const EVENT_INSERT_CHUNK_SIZE = 5000;

export async function createBalanceHistoryEvents(
  userId: string,
  rows: BalanceHistoryEventRow[],
  client: AccountDbClient = prisma,
): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += EVENT_INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + EVENT_INSERT_CHUNK_SIZE);
    const result = await client.accountBalanceEvent.createMany({
      data: chunk.map((r) => ({
        userId,
        accountId: r.accountId,
        balance: new Prisma.Decimal(r.balance),
        asOf: dateStringToUtcDate(r.asOf),
      })),
    });
    inserted += result.count;
  }
  return inserted;
}

// ── Net-worth-over-time series (Phase 3, Task 8) ───────────────────────────
// Feeds lib/net-worth-history.ts's computeNetWorthSeries, which
// app/(app)/net-worth/page.tsx calls server-side — the raw event log this
// function returns never reaches the browser, only the derived
// NetWorthPoint[] does.

export interface AccountSeriesRosterRow {
  id: string;
  type: AccountType;
  archivedAt: string | null;
}

// EVERY account, archived included — deliberately NOT listAccounts, whose
// `archivedAt: null` filter would drop an archived account from this roster
// entirely. computeNetWorthSeries treats a roster miss as "no type to key
// the asset/liability taxonomy off of" and discards that account's events
// outright, which would erase a closed account from every PAST chart point
// too (the years it was genuinely open), not just today's. The summary
// cards keep using listAccounts; only the chart roster uses this.
export async function listAccountsForSeries(userId: string): Promise<AccountSeriesRosterRow[]> {
  const rows = await prisma.account.findMany({
    where: { userId },
    select: { id: true, type: true, archivedAt: true },
  });
  return rows.map((r) => ({
    id: r.id,
    type: r.type as AccountType,
    archivedAt: r.archivedAt ? r.archivedAt.toISOString() : null,
  }));
}

export interface BalanceEventSeriesRow {
  accountId: string;
  asOf: string; // "YYYY-MM-DD"
  balance: number;
  recordedAt: string; // ISO
}

// Selects only the four columns computeNetWorthSeries reads (never
// `SELECT *`) and orders in Postgres rather than pulling ~34,000 rows into
// JS unsorted, per the Task 8 brief's volume note. Measured against a
// synthetic 33-account/~34,000-event table on this app's dev Postgres:
// Postgres chooses a scan on the plain `userId` index followed by an
// in-memory quicksort over the [accountId, asOf] composite index from Task
// 5 — the single-user WHERE clause already narrows the result set small
// enough that the planner doesn't need the composite index for this shape
// of query — but execution stays at single-digit milliseconds even at full
// realistic volume (~6-16ms server-side; see Task 8's report for the exact
// EXPLAIN ANALYZE output). computeNetWorthSeries also re-sorts each
// account's own events after grouping regardless of input order, so this
// ORDER BY isn't load-bearing for correctness either — it exists purely so
// the query layer never has to redo that ordering work in JS.
export async function listBalanceEventsForSeries(userId: string): Promise<BalanceEventSeriesRow[]> {
  const rows = await prisma.accountBalanceEvent.findMany({
    where: { userId },
    select: { accountId: true, asOf: true, balance: true, recordedAt: true },
    orderBy: [{ accountId: "asc" }, { asOf: "asc" }],
  });
  return rows.map((r) => ({
    accountId: r.accountId,
    asOf: utcDateToDateString(r.asOf),
    balance: r.balance.toNumber(),
    recordedAt: r.recordedAt.toISOString(),
  }));
}
