# 0001 — Dedup imported transactions on Monarch's `Id`, not a content hash

**Status:** Accepted · **Origin:** Ruling 1, net-worth phase 2–3 plan
**Code:** `buildExternalHash` in `lib/monarch-transform.ts`

## Decision

`externalHash` is `"mid:<Id>"` when the export's `Id` column is present and
non-empty, and `"sha:" + sha256(date|abs(amount)|account|merchant|originalStatement)`
when it is not. The `mid:` / `sha:` prefixes keep the two key-spaces disjoint
and say which path produced a given value.

## Why

`Id` is stable across exports. The composite hash keys on `merchant`, which
Monarch users routinely rename in its UI — so a rename would change the hash
and silently re-import a row that was already there.

## Rejected alternative

Hashing content unconditionally. Simpler, and wrong for the common case: a
renamed merchant is an edit, not a new transaction.

## Cost if wrong

If a future export reuses `Id`s across accounts, distinct rows would be
skipped as duplicates. Bounded by `@@unique([userId, externalHash])` already
being per-user.
