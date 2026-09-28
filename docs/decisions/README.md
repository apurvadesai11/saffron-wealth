# Decision records

Short records of decisions the code depends on, so a source comment can state
the current invariant and link here instead of carrying the argument that
produced it.

The numbered "Ruling N" references that appear in `lib/` come from the net-worth
phase plans. They were cited in source comments without being defined anywhere
a reader of that file could reach, which is what this directory fixes: each one
now has a file, and the source comment says what is true today plus where the
reasoning lives.

A ruling that was later overturned keeps its record, marked **Superseded**,
with a pointer to what replaced it. Deleting it would leave the next person to
rediscover the same wrong answer.

| # | Decision | Status |
|---|----------|--------|
| [0001](0001-dedup-on-monarch-id.md) | Dedup imported transactions on Monarch's `Id`, not a content hash | Accepted |
| [0002](0002-lenient-csv-header-validation.md) | Validate a CSV header by required-columns-present, ignoring extras | Accepted |
| [0003](0003-account-contribution-window.md) | An account contributes to the net-worth series only inside its event window | Accepted (amended) |
| [0004](0004-sign-before-keywords.md) | Guess asset-vs-liability from the balance sign first, refine by keyword second | Accepted (amended) |
| [0005](0005-non-account-denylist.md) | Skip the two medical tracker rows; import everything else | Accepted |
| [0006](0006-street-names-are-not-keywords.md) | Street names do not belong in the account-type keyword table | Accepted |
| [0007](0007-never-retype-an-existing-account.md) | An import never re-types an account that already exists | Accepted (supersedes Ruling 7) |
| [0008](0008-balance-event-asof-without-unique-constraint.md) | `AccountBalanceEvent` carries `asOf`, deduped in application code rather than by a unique constraint | Accepted |
| [0009](0009-same-day-events-tiebreak-on-recordedat.md) | Same-`asOf` events tiebreak on `recordedAt` descending | Accepted |
| [0010](0010-utc-persistence-local-period-math.md) | Persistence is UTC, period math is local, `"YYYY-MM-DD"` crosses between them | Accepted |
| [0011](0011-signed-contribution-at-write-time.md) | A balance event stores the signed contribution, applied at write time | Accepted |

## Where "Task N" references point

Source comments also cite task numbers from the phase plans. Those are sections
of the plan documents in `docs/`, not of this directory:

| Reference | Plan | What it built |
|-----------|------|---------------|
| Task 1 | [phase 2–3 plan](../saffron-wealth-net-worth-phase2-3-plan.md) | `lib/csv.ts` — papaparse wrapper and header validation |
| Task 2 | same | `lib/monarch-transform.ts` — pure row transforms |
| Task 3 | same | The Monarch transaction import (`lib/transaction-import.ts`) |
| Task 4 | same | `AccountBalanceEvent.asOf` and the schema change behind it |
| Task 5 | same | Account upsert from balance history, including the archive rule |
| Task 6 | same | `lib/net-worth-history.ts` — the net-worth-over-time series |
| Task 8 | same | The Net Worth page's chart, summary cards and account list |

Phase 1's own tasks are in the [phase 1 plan](../saffron-wealth-net-worth-phase1-plan.md).
