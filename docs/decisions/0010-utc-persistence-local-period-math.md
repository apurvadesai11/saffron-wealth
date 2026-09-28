# 0010 — Persistence is UTC, period math is local, `"YYYY-MM-DD"` crosses between

**Status:** Accepted · **Origin:** item 20d, `docs/audit-remediation-plan.md`
**Code:** `lib/date-utils.ts` (UTC) and `lib/budget-utils.ts` (local)

## Decision

Two date conventions coexist, deliberately, and are not being unified:

- **Persistence and query layers are UTC.** `dateStringToUtcDate` /
  `utcDateToDateString` in `lib/date-utils.ts`, used by `lib/transactions.ts`
  and `lib/accounts.ts`.
- **Period and calendar math is local.** `parseLocalDate` and everything built
  on it in `lib/budget-utils.ts`.
- **`"YYYY-MM-DD"` strings are the interchange format.** Every value crossing
  the boundary is a string, never a `Date`.

## Why each side is right

The columns the persistence layer feeds — `Transaction.date`,
`Account.balanceAsOf`, `AccountBalanceEvent.asOf` — are all `@db.Date` with no
time component, and the value has to land on the exact calendar day named.
`new Date(y, m, d)` builds *local* midnight, which serializes to the previous
calendar day in any negative-UTC-offset timezone.

A budget month, by contrast, is whatever month the user is standing in.
Deriving period bounds in UTC would put someone at UTC-8 into next month's
budget for the last sixteen hours of every month.

## Why not unify

Unifying means choosing one convention and breaking the reasoning behind the
other. The string pivot keeps round-trips consistent, so this is a maintenance
hazard — a future author reading one file will get the other wrong — rather
than a live bug. Documenting the boundary addresses the hazard without
breaking either side.

## One apparent violation that is not one

`validateDate` in `lib/transaction-validation.ts` constructs a local `Date` to
check that a string names a real calendar day. It is a round-trip check, the
`Date` never leaves the function, and reading the fields back in the same
calendar system is what makes the comparison meaningful.

## Rule of thumb

If it touches the database, it is UTC.
