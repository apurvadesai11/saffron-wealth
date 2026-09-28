# 0006 — Street names do not belong in the account-type keyword table

**Status:** Accepted · **Origin:** Ruling 6, net-worth phase 2–3 plan
**Code:** `ASSET_TYPE_RULES` in `lib/monarch-transform.ts`

## Decision

The keyword table names account *kinds* and card networks. It does not name
particular streets, institutions or products.

## Why

A keyword guessing at one specific street name ("terrace") caused a concrete
error: a transactions-first import has no balance to sign-check, so the
street-address-named **mortgage** typed as `property` — an asset. The
subsequent balance-history import then declined to correct it, because it
never re-types an existing account (see
[0007](0007-never-retype-an-existing-account.md)). The result was an
outstanding loan counted as an equally large asset: a net-worth error of twice
the balance.

The keyword bought nothing either, since the property account sharing that
street name was already an accepted miss.

## Extended by item 15

The same reasoning applied to a set of specific card products that had
accumulated in the table — "sapphire", "bankamericard", "circle card", "red
card", "citi". Those are gone too. An unrecognized account is now
`uncategorized`, excluded from every net-worth total and surfaced in the
import preview for its owner to classify, which is a better answer than
guessing from one person's account names.

## Cost if wrong

A genuinely property-named account guesses as unclassified rather than
`property`. Visible in the preview, one edit to fix.
