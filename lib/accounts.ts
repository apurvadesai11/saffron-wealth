// Server-only query layer for accounts. Every function is scoped to a userId
// and treats {id, userId} as the ownership check — a mismatched id resolves to
// null/false rather than throwing, so callers can map that straight to 404.
import { Prisma, type PrismaClient, type Account as PrismaAccount } from "@prisma/client";
import { prisma } from "./prisma";
import { guessAccountType } from "./monarch-transform";
import { getBucketForType, isLiability } from "./account-utils";
import type { Account, AccountInput, AccountPatch, AccountType } from "./types";
// Account.balanceAsOf and AccountBalanceEvent.asOf must land on the exact
// calendar day a CSV row names; see lib/date-utils.ts.
import { dateStringToUtcDate, utcDateToDateString } from "./date-utils";

// AccountBalanceEvent.balance is the signed contribution to net worth;
// Account.balance is the value in its bucket's natural direction. They differ
// by exactly this negation on the debt side. Neither is clamped — both can
// legitimately be negative. See
// docs/decisions/0011-signed-contribution-at-write-time.md.
function contributionFor(type: AccountType, balance: Prisma.Decimal): Prisma.Decimal {
  return isLiability(getBucketForType(type)) ? balance.negated() : balance;
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

// The Restore surface's read side: every account
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
        balance: contributionFor(input.type, balance),
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
  // Restore is the one PATCH shape that must find an
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

  // The type this account will have after the patch — what any new balance
  // event has to be signed against.
  const nextType = (patch.type ?? existing.type) as AccountType;
  // A bucket-crossing type change is the one edit that SHOULD reinterpret
  // existing history, and it is applied here as an explicit write — which is
  // what lets the read path stay type-independent. See
  // docs/decisions/0011-signed-contribution-at-write-time.md.
  const bucketCrossed =
    isLiability(getBucketForType(nextType)) !==
    isLiability(getBucketForType(existing.type as AccountType));

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
    // Before appending, so a patch that changes both type and balance
    // doesn't flip the new event it just wrote. One statement rather than
    // read-modify-write: an account can carry years of daily events, and
    // negation is something Postgres can do in place.
    if (bucketCrossed) {
      await tx.$executeRaw`UPDATE "AccountBalanceEvent" SET balance = -balance WHERE "accountId" = ${id}`;
    }
    if (balanceChanged) {
      await tx.accountBalanceEvent.create({
        data: {
          userId,
          accountId: id,
          balance: contributionFor(nextType, nextBalance!),
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
      const created = await client.account.create({
        data: {
          userId,
          name,
          type: guessAccountType(name),
          balance: new Prisma.Decimal(0),
        },
      });
      // Deliberately NO opening-balance event here, unlike createAccount: a
      // transaction export carries no balances, so no event is the honest
      // representation. computeNetWorthSeries omits an account with no
      // events, and the balance-history import supplies the real history.
      // See docs/decisions/0008-balance-event-asof-without-unique-constraint.md.
      idByName.set(name, created.id);
    }
  }

  return { idByName, newNames };
}

// ── Balance history import ─────────────────────────────────────────────────
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
  // account, and for an existing one always the type it already has — the
  // import never re-types an account the user may have corrected.
  finalType: AccountType;
  archived: boolean;
  // Set only when an EXISTING account's stored bucket disagrees with the
  // sign of its imported final balance. Surfaced in the preview so the user
  // resolves it once, deliberately, instead of the import deciding silently.
  typeConflict?: { storedType: AccountType; suggestedType: AccountType };
}

// Resolves each CSV account group to an Account row: creates ones that don't
// exist, and updates balance/balanceAsOf/archivedAt on ones that do. An
// existing account's `type` is NEVER overwritten. When its stored bucket
// disagrees with the sign of the imported final balance, that shows up as a
// `typeConflict` on the result for the preview to put in front of the user.
//
// The type is a stable property of the account; the sign belongs to the
// balance. An earlier version overwrote the type when the two disagreed —
// see docs/decisions/0007-never-retype-an-existing-account.md for why that
// was both a no-op in the case it was built for and destructive elsewhere.
//
// Read-only unless `write` is true, so preview and commit share this exact
// code path and can never disagree about what's "new" or "archived"
// (mirrors resolveAccountIds/resolveCategoryIds above).
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
    // An account whose last row is older than the file's max date has stopped
    // reporting — Monarch exports daily for every genuinely active account, so
    // this is a reliable "closed" signal. Soft-archive rather than delete so
    // its history still feeds the graph. See
    // docs/decisions/0003-account-contribution-window.md.
    const archivedByThisImport = group.lastDate < fileMaxDate;
    const balanceAsOf = dateStringToUtcDate(group.lastDate);

    if (!existing) {
      // Natural direction, unclamped: a card carrying a statement credit is
      // a negative amount owed, and an overdrawn asset is negative too. See
      // docs/decisions/0011-signed-contribution-at-write-time.md.
      const balance = guessedIsDebt
        ? -group.finalBalanceSigned
        : group.finalBalanceSigned;
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

    const storedType = existing.type as AccountType;
    const existingIsDebt = isLiability(getBucketForType(storedType));
    const signDisagrees =
      (existingIsDebt && group.finalBalanceSigned > 0) || (!existingIsDebt && group.finalBalanceSigned < 0);
    // Reported, not acted on. A conflict where the re-guess lands on the
    // stored type anyway (a card-named account with a credit) is not worth
    // asking about — there is no alternative to offer.
    const typeConflict =
      signDisagrees && guessedType !== storedType
        ? { storedType, suggestedType: guessedType }
        : undefined;
    const balance = existingIsDebt
      ? -group.finalBalanceSigned
      : group.finalBalanceSigned;

    // Monotone archiving: this import may ADD an archivedAt, but must never
    // CLEAR one already set. Archiving-by-absence is an inference (see
    // docs/decisions/0003-account-contribution-window.md); an already-set
    // archivedAt might be an explicit user delete, and an inference must not
    // override an explicit action. Monotone rather than "never touch on
    // update" so an account that closes BETWEEN two imports still gets
    // archived by the second one — it just can never be un-archived.
    const archivedAtValue = existing.archivedAt ?? (archivedByThisImport ? importedAt : null);

    if (write) {
      await client.account.update({
        where: { id: existing.id },
        data: {
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
      finalType: storedType,
      archived: archivedAtValue !== null,
      ...(typeConflict ? { typeConflict } : {}),
    });
  }

  return results;
}

// Dedup lookup for the balance-history import's event insert.
// AccountBalanceEvent deliberately has no unique constraint on
// (accountId, asOf) — Phase 1 legitimately writes more than one event for one
// account on one day — so "have we already recorded this account on this day"
// is checked in application code against a Set built from one query. See
// docs/decisions/0008-balance-event-asof-without-unique-constraint.md.
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

// A full Monarch export is ~34,000 rows, and one row at a time would be
// 34,000 round trips. ~5,000 per call keeps that in single digits.
//
// Belt-and-braces rather than load-bearing: an unchunked createMany would not
// produce one oversized statement either, because Prisma's query engine splits
// it at ~32,760 bind parameters (7,600 rows became 4 statements in 435ms).
// Kept because 5,000 x 6 columns =
// 30,000 parameters sits just under that engine cap, which makes the
// statement count predictable rather than an implementation detail of
// whatever Prisma version is installed.
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

// ── Net-worth-over-time series ─────────────────────────────────────────────
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
// JS unsorted. Measured on a synthetic 33-account / ~34,000-event table
// against this app's dev Postgres at 6-16ms server-side: the planner scans
// the plain `userId` index and quicksorts in memory, because the single-user
// WHERE clause already narrows the set enough that it doesn't reach for the
// [accountId, asOf] composite index.
//
// The ORDER BY is not load-bearing for correctness — computeNetWorthSeries
// re-sorts each account's events after grouping regardless of input order. It
// exists so the query layer never has to redo that work in JS.
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
