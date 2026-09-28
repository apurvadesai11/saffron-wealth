# 0005 — Skip the two medical tracker rows; import everything else

**Status:** Accepted · **Origin:** Ruling 5, net-worth phase 2–3 plan
**Code:** `NON_ACCOUNT_NAMES` in `lib/monarch-transform.ts`, applied in `lib/balance-history-import.ts`

## Decision

An exact, case-insensitive denylist of two names — `Individual innetwork
medical deductible` and `Individual innetwork medical outofpocket` — is
skipped during the balance-history import, and counted in the summary as
`skippedNonAccountRows` rather than dropped silently.

## Why

They are insurance deductible and out-of-pocket progress counters, not
balances. Imported as accounts they would inflate assets. The other
oddly-named rows in the same export are real accounts that end at or near $0,
so importing them is harmless and their owner can archive them.

The separate counter exists so the preview can say what happened; folding
them into the malformed-row silence would make a deliberate skip
indistinguishable from a parse failure.

## Known limitation

Two literal strings from one person's export, in a shared source constant.
They generalize to no second user. Turning this into a per-user exclusion
list seeded empty is item 15a of `docs/audit-remediation-plan.md`; it needs a
migration and has not been done.

## Cost if wrong

A future export names a real account one of those two strings. Vanishingly
unlikely, and the list is one line to amend.
