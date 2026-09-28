# 0002 — Validate a CSV header by required-columns-present, ignoring extras

**Status:** Accepted · **Origin:** Ruling 2, net-worth phase 2–3 plan
**Code:** `validateHeader` in `lib/csv.ts`; `buildColumnLookup` in both import pipelines

## Decision

Require only the columns the pipeline cannot work without — `Date`, `Amount`,
`Account`, `Category` for transactions; `Date`, `Balance`, `Account` for
balance history. Use `Merchant`, `Original Statement`, `Notes`, `Id` when
present. Ignore every other column. Fail only on a missing *required* column,
echoing the header actually found.

## Why

An earlier version expected exactly nine columns and tolerated eight, which
would have rejected the real eleven-column export outright. Monarch has added
columns twice and will again.

## Consequence worth knowing

A header validated leniently must also be *read* leniently. Both pipelines
build a normalized (trimmed, lowercased) lookup from header name to the
column's actual spelling, because papaparse keys each row object by the
header's own text — a column matched only by its normalized name would
otherwise read as empty rather than failing loudly.

## Cost if wrong

A genuinely malformed file carrying the right required columns gets further
into the pipeline before failing. Row-level validation still drops it.
