# 0013 — The financial profile is append-only versions

**Status:** Accepted · **Origin:** Financial Profile plan (roadmap #1)
**Code:** `FinancialProfile` in `prisma/schema.prisma`; `saveFinancialProfile` in `lib/financial-profile.ts`

## Decision

Each save that changes anything inserts a complete new `FinancialProfile` row
(with fresh `FinancialProfileIncome` / `FinancialProfileContribution` children)
carrying the next `version` for that user and `effectiveAt = now`. No row is
ever updated. The current profile is the highest version.

A save that changes nothing writes nothing and returns the existing version.

Saves are serialized per user with `pg_advisory_xact_lock`, taken before the
latest version is read. `@@unique([userId, version])` is the backstop.

## Why

These are assumptions, not facts, and they change: a raise, a revised return
expectation, a new retirement target. Projections, FIRE and retirement planning
will all compute from them. A single mutable row would make every number
computed last year unreproducible the moment the user edits a field — the same
reason `AccountBalanceEvent` is append-only.

## Why a no-op save writes nothing

The version number is shown to the user ("Version 3 · saved …"). Re-saving an
untouched form should not mint a version that differs from the last one in
nothing but its timestamp. Equality is checked on the *derived* profile
(`toProfileInput` with today's age — see 0014), so a re-save a year later with
the age the form pre-filled is still recognized as unchanged.

The parser rounds percents to two decimals and amounts to cents before the
comparison. Without that, Postgres would round `3.255` to `3.26` on insert, the
next identical save would compare unequal, and every save would write a
phantom version.

## Why the lock

Two tabs saving at once would both read version N and both try to write N+1;
one would fail on the unique constraint and surface as a 500. The lock turns
that into two consecutive versions. Single-user app, rare in practice, but the
failure mode was a server error on an ordinary action.

## Rejected alternatives

- **One mutable row** — simplest, but loses history; see above.
- **One row per changed field** (event log) — a finer audit trail, but
  reconstructing "the profile as of date D" becomes a fold over every field's
  events, and the list-shaped inputs (income streams, contribution targets)
  have no natural per-field identity. A whole snapshot per version is a single
  indexed read.

## Cost if wrong

Storage grows by one small row set per real edit — negligible at personal
scale. If version history ever needs pruning, it is a delete of old versions
with no schema change.
