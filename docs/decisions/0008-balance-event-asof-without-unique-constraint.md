# 0008 — `AccountBalanceEvent` carries `asOf`, deduped in application code

**Status:** Accepted · **Origin:** Ruling 8, net-worth phase 2–3 plan
**Code:** `prisma/schema.prisma`; `findExistingBalanceEventDays` in `lib/accounts.ts`

## Decision

`AccountBalanceEvent` has `asOf DateTime @db.Date` — the date a balance was
true — alongside `recordedAt`, which stays the write-time audit trail.

There is deliberately **no** `@@unique([accountId, asOf])`. The import dedups
in application code: it reads the affected accounts' existing
`(accountId, asOf)` pairs into a Set and filters before inserting.

## Why not a unique constraint

Phase 1 legitimately appends an event on every balance change, so a user
editing one account's balance twice in a day is normal rather than a data bug.
A unique constraint would turn that into a 500 on a previously working action.
Application-level dedup gets idempotent re-import without regressing Phase 1.

## Why `asOf` had to exist at all

The original schema had only `recordedAt @default(now())` — a write timestamp,
not a balance-as-of date. Both earlier plan versions assumed a date field that
did not exist. The column was added with `@default(now())`, which backfills
existing Phase 1 rows correctly: a manually entered balance *was* as-of its
entry date.

## Known limitation

The dedup is presence-only, not value-comparing. If a day already has an event
and a later import carries a *revised* balance for that same day, the revision
is dropped and the existing value stays. There is currently no way to
re-import a corrected historical balance short of deleting the event row.

## Cost if wrong

A concurrent double-import could race past the Set check and duplicate rows.
Single-user app, sequential imports behind a confirm step — accepted.
