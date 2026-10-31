# 0014 — Age is stored as typed, anchored to the version's date

**Status:** Accepted · **Origin:** Financial Profile plan (roadmap #1)
**Code:** `FinancialProfile.ageAtEffective`; `ageOn` in `lib/financial-profile-utils.ts`

## Decision

The form asks for the user's **current age**. The version stores that number as
`ageAtEffective`, and the current age at any later instant is

    ageAtEffective + whole years elapsed since effectiveAt

computed by `ageOn`. Everything that needs an age — the form's pre-fill, the
no-op comparison in 0013, and later the projections — derives it this way.
Nothing reads `ageAtEffective` as if it were today's age.

## Why not a birth date or birth year

The author chose age as the input. A birth date is more sensitive than any
planning calculation needs, and planning math works in whole years.

Storing age alone would go stale: a profile saved at 35 would still claim 35 a
decade later. Anchoring it to `effectiveAt` keeps it true without asking again.

## Precision

The user's birthday is unknown, so the derived age moves forward on the
anniversary of the save, not of the birth. It can lag the true age by less than
a year and never runs ahead of it. Re-saving the profile re-anchors it to
whatever age the user types then.

## Calendar

`ageOn` compares the UTC fields of two instants. That is neither of the
conventions in 0010 — it is not a calendar date being persisted, nor a budget
period in the user's local time — it is elapsed time between two timestamps,
and using the same calendar on both sides is what makes the comparison exact.

## Cost if wrong

At worst a projection treats the user as up to a year younger than they are
until they next save. If that matters later, adding a birth month is a new
nullable column and a sharper `ageOn`.
