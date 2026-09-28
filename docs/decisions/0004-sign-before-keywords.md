# 0004 — Guess asset-vs-liability from the balance sign first, refine by keyword second

**Status:** Accepted, amended by item 15 · **Origin:** Ruling 4, net-worth phase 2–3 plan
**Code:** `guessAccountType` in `lib/monarch-transform.ts`

## Decision

When a balance is available and negative, the account is a liability — a
mortgage or loan if the name says so, a credit card otherwise. Only when the
sign is unavailable or non-negative does the ordered keyword table decide.

## Why

In the real data the mortgage is named after the street address it secures and
carries the original loan amount in the name, with no debt keyword anywhere in
it — while the property it secures is named after that same street. No keyword
can separate those two. The sign always can.

`"Orig. $"` is Monarch's own loan-origination marker, which is why it is a
liability keyword rather than a dollar-amount artifact for `parseAmount` to
strip.

## Ordering inside the keyword table is load-bearing

`"roth 401"` must beat `"401k"`; `"health savings"` must beat `"savings"`, or
an HSA reads as plain cash; `"rsu"` and `"restricted unit"` must beat
`"individual"`, or `"INDIVIDUAL - Globex RSU"` reads as a plain brokerage
account.

## Amendment — item 15

Two changes, both correctness fixes:

- **Matching is on term boundaries, not substrings.** `text.includes(keyword)`
  matched a keyword buried inside a longer word: `"citi"` matched
  `"Citibank Checking"` and `"ira"` matched `"Iraq"`, classifying a cash asset
  as a credit card — which moves it into the debt bucket and inverts its sign
  in the net-worth calculation. Boundaries are asserted only at whichever ends
  of a keyword are themselves alphanumeric, because `"orig. $"` ends in `$`
  and is followed by a digit in the real data.
- **Word boundaries are not enough on their own.** `"Visa Debit Checking"`
  genuinely contains the word `"Visa"`, and the credit-card row is checked
  before cash. That row therefore carries an explicit `excludeKeywords:
  ["debit"]`.

The catch-all also no longer returns `"cash"` — see
[0006](0006-street-names-are-not-keywords.md).

## Cost if wrong

A credit card at a zero or credited balance on its first event reads as an
asset. Bounded: the user reviews guessed types in the import preview before
committing.
