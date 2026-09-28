# 0009 — Same-`asOf` events tiebreak on `recordedAt` descending

**Status:** Accepted · **Origin:** Ruling 9, net-worth phase 2–3 plan
**Code:** `lib/net-worth-history.ts`

## Decision

Where an account has more than one `AccountBalanceEvent` for the same `asOf`
date, the one written last — highest `recordedAt` — is the value the series
uses for that day.

## Why

[0008](0008-balance-event-asof-without-unique-constraint.md) deliberately
permits several events per `(accountId, asOf)`, which makes "the most recent
event at or before date D" ambiguous. The latest-written value for a date is
the user's latest word on it.

## Consequence for the import

Two rows in one file for the same account and day would produce two events
with the same `asOf` *and* the same `recordedAt` — they land in one
`createMany` batch — leaving this tiebreak nothing to choose between. The
balance-history import therefore collapses a repeated `(account, date)` pair
to its last occurrence in the file before building event candidates.

## Cost if wrong

An ordering flip on a same-day double edit. Sub-dollar impact.
