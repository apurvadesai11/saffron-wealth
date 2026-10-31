# 0014 — Age is stored as an anchor with its own date

**Status:** Accepted · **Origin:** Financial Profile plan (roadmap #1), revised in its final review
**Code:** `FinancialProfile.anchoredAge` / `ageAnchoredAt`; `ageOn` in `lib/financial-profile-utils.ts`; the anchor rule in `saveFinancialProfile` (`lib/financial-profile.ts`); `buildBody` in `components/FinancialProfileClient.tsx`

## Decision

The form asks for the user's **current age**. A version stores an *anchor*: an
age (`anchoredAge`) and the instant it was true (`ageAnchoredAt`). The current
age at any later instant is

    anchoredAge + whole years elapsed since ageAnchoredAt

computed by `ageOn`. Everything that needs an age — the form's pre-fill, the
no-op comparison in 0013, and later the projections — derives it this way.
Nothing reads `anchoredAge` as if it were today's age.

**The anchor moves only when the age does.** When a save's age equals the age
the latest version already implies (`ageOn(latest, now)`), the new version
copies the latest version's anchor forward unchanged. Only a different number
— the user correcting their age — anchors to the save's own time.

The form holds up its end: if the age field hasn't been edited, it sends
`ageOn(profile, now)` at submit time rather than the number it rendered with.

## Why not a birth date or birth year

The author chose age as the input. A birth date is more sensitive than any
planning calculation needs, and planning math works in whole years.

Storing age alone would go stale: a profile saved at 35 would still claim 35 a
decade later. The anchor keeps it true without asking again.

## Rejected: anchoring the age to the version's own date

The first version of this record stored the typed age against `effectiveAt`.
Each changed save then stored the pre-filled age — already rounded down to
whole years — anchored to *now*, discarding the part-year already elapsed. Save
at 35 in January, change only the inflation assumption every eleven months, and
three years later the profile still said 35. Any normal use of the page (a
raise, a new contribution target) froze the age. Every number built on it would
be years off, silently.

A separate anchor is what lets the age's history be independent of how often
the other inputs change.

## Why the form sends the age as of the save

A page rendered just before the anchor's anniversary and saved just after would
otherwise send the stale pre-filled age. That is one year lower than the age
the server now derives, which looks exactly like a deliberate correction, and
the age would re-anchor a year low. The form knows whether the user touched the
field; the server does not, so the form is where that distinction is made.

## Precision

The user's birthday is unknown, so the derived age moves forward on the
anniversary of the anchor, not of the birth. It can lag the true age by less
than a year and never runs ahead of it. Correcting the age re-anchors it to
whatever the user types.

## Calendar

`ageOn` compares the UTC fields of two instants. That is neither of the
conventions in 0010 — it is not a calendar date being persisted, nor a budget
period in the user's local time — it is elapsed time between two timestamps,
and using the same calendar on both sides is what makes the comparison exact.

## Cost if wrong

At worst a projection treats the user as up to a year younger than they are
until they correct it. If that matters later, adding a birth month is a new
nullable column and a sharper `ageOn`.
