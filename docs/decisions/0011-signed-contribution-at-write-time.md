# 0011 — A balance event stores the signed contribution, applied at write time

**Status:** Accepted · **Origin:** net-worth phase 3 review
**Code:** `contributionFor` in `lib/accounts.ts`; `computeNetWorthSeries` in `lib/net-worth-history.ts`

## Decision

`AccountBalanceEvent.balance` **is** the account's signed contribution to net
worth on that date — negative reduces it. Every writer (`createAccount`,
`updateAccount`, the balance-history import) applies the account's bucket once,
at write time.

`Account.balance` is a different thing: the value in its bucket's *natural*
direction — what you hold for an asset, what you owe for a debt. The two differ
by exactly one negation on the debt side.

The read path never consults `account.type` to decide a sign.

## Why at write time

Applying the bucket at write time captures the user's own assertion about what
the account is while it is fresh, and makes existing history immutable under a
later reclassification.

The alternative — negating by the *current* type at read time — meant a bucket
change flipped the meaning of every row already written, including rows a later
import skipped as duplicates and so could never correct. A single edit
retroactively rewrote years of history.

## The one exception, and why it is explicit

A type change that crosses the asset/liability line *should* reinterpret
existing history: the user is asserting the account was always this kind of
thing, so its recorded contributions had the wrong sign all along.
`updateAccount` applies that as an explicit write over the account's events.
Doing it as a write rather than at read time is what lets the read path stay
type-independent.

## Neither value is clamped

Both can legitimately be negative: an overdrawn checking account, and a card
carrying a statement credit. Earlier versions clamped both and each way was
wrong — `Math.abs` on the debt side read a $500 credit as $500 *owed*,
disagreeing with the same account's event history by $1,000, and `Math.max` on
the asset side hid an overdraft and overstated net worth.

## Cost if wrong

An event written under a bucket the user later decides was wrong keeps its
original sign unless they edit the account type, which is the explicit
correction path.
