# 0007 — An import never re-types an account that already exists

**Status:** Accepted. **Supersedes Ruling 7**, which said the opposite.
**Code:** `upsertAccountsFromBalanceHistory` in `lib/accounts.ts`

## Decision

The balance-history import creates accounts it has not seen and updates
`balance`, `balanceAsOf` and `archivedAt` on ones it has. It never overwrites
an existing account's `type`.

When an existing account's stored bucket disagrees with the sign of its
imported final balance, that is reported as a `typeConflict` on the result, for
the preview to put in front of the user. The import does not act on it.

## What this replaces

Ruling 7 said the import should re-guess the type with the sign and overwrite
when the two disagreed, on the grounds that the institution's sign is ground
truth and a keyword guess is not. That was wrong twice over:

1. **It was a no-op in the case it was built for.** `guessAccountType` only
   consults the sign on its negative branch. A card-named account carrying a
   credited (positive) balance re-guesses back to `credit_card`, so the
   override fired and changed nothing.
2. **Where it did change something, it was destructive.** It overwrote a type
   the user had deliberately set. One month of statement credit is not
   evidence that a credit card is a cash account.

The type is a stable property of the account. The sign belongs to the balance.

## Consequence

Reporting the conflict rather than resolving it is the shape the import uses
generally: surface the choice, let its owner make it once, deliberately. Item
15c reuses it for accounts the type guess could not classify at all.

Because the type is never overwritten, a user's correction survives every
later import — which is what makes an `uncategorized` guess safe to assign
rather than a treadmill.

## Cost if wrong

A genuinely mistyped account stays mistyped until someone edits it. Visible in
the preview on every import that touches it.
