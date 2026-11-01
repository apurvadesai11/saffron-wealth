# 0016 — The spending baseline is the full-history average in today's dollars, with big one-offs amortized

**Status:** Accepted · **Origin:** FIRE calculator plan (roadmap #4)
**Code:** `computeSpendingBaseline`, `isRecurringCharge` and `cpiFactor` in `lib/fire-spending.ts`

## Decision

Annual spending, the numerator of the FI number, is the average monthly
expense over **every complete month** of transaction history, times 12, with
each transaction restated in today's dollars by the CPI ratio between its month
and `asOf`'s.

The window ends the month before `asOf` (the current month is partial) and
starts the month after the earliest expense, because an import rarely begins
on the 1st and a part-month would understate spend. The earliest month is kept
when that expense is on the 1st, or when dropping it would leave no month at
all. Months with no spend count in the average. Only `type === "expense"`
counts; transfers and income are ignored.

A **big purchase** is spread over its useful life instead of landing in the
month it happened: one whose restated amount is at least
`BIG_PURCHASE_THRESHOLD` ($5,000) and that is not a recurring charge. It adds
`realAmount / max(window years, BIG_PURCHASE_LIFE_YEARS)` a year, with the life
at 10 years. Everything else goes into the plain average.

A charge is **recurring** when some other expense has the same merchant (the
merchant, or the description when there is none, trimmed and lower-cased), an
amount within 25% of the larger of the two, and a date 25 to 400 days away.
That covers monthly through annual bills. Measuring against the larger amount
makes the test symmetric: a pair of charges is recurring from both sides or
from neither, where measuring from each charge's own amount let an $8,000
premium vouch for a $6,100 one but not the reverse.

## Why the whole history

The FI number is spending times 25 or more, so any noise in the baseline is
multiplied by 25. A year of data is too short to contain a car, a roof or an
uninsured medical bill; ten years of it is a fair sample of what life costs.
Restating in today's dollars is what lets old and recent months be averaged
together: a 2019 grocery bill is not the same quantity as a 2026 one. The
projection runs in real dollars throughout, so the baseline has to be in real
dollars to match.

CPI is the monthly table from `lib/cpi-data.ts`. The newest months aren't
published when a month ends, so past the table's last month the last level is
carried forward at the profile's inflation assumption; before the table's first
month its first level is held. `cpiThrough` reports where the real data stopped.

## Why amortize, rather than cap or trim

A car is not noise. Cars, roofs and appliances recur over a lifetime, and the
FI number exists to cover a lifetime.

- **Trim** the outlier (drop the top few purchases from the average) and the
  baseline pretends the car was free, so the plan retires you earlier than the
  history supports.
- **Cap** each purchase at some ceiling and the part above it vanishes the same
  way, and a cap tuned to a car is wrong for a house repair.
- **Amortize** keeps all of the money and moves it to the rate it is actually
  consumed at. A $30,000 car in a short history is $3,000 a year, not $30,000 in
  one month and nothing in the other 22.

Ten years is a single named constant for "cars, roofs and the like". When the
history is longer than that, the divisor is the history itself, so a big
purchase then carries exactly its share of the window and amortizing agrees with
the plain average: a long record is its own amortization.

## Why a recurrence test, and why it compares amounts

A threshold alone amortizes the rent. A $5,500 monthly rent is "big", and
spreading each month's payment over ten years would count a tenth of it,
dropping the largest line in most budgets by 90%. A bill that comes round again
is not a one-off, so recurring charges stay in the plain average at any size.

The test could have been "same merchant seen more than once". That fails at
frequent merchants: a $6,000 purchase at a retailer you also buy $40 things
from is the same merchant and not the same bill. Requiring a similar amount is
what makes it the *same bill*. A 25% band absorbs a premium that rises, a rent
that steps up, a utility that follows the seasons, without matching unrelated
purchases. Amounts are compared nominal; across at most 400 days, inflation is
well inside that band.

The 25-day floor keeps two purchases in one month at one shop from vouching for
each other; the 400-day ceiling is a year with slack for a due date that drifts.
Evidence is taken from the whole expense history, including the dropped first
month and the current partial month. They aren't averaged, but they still show
that the neighbouring charge in the window is a bill.

## Known blind spot

An annual bill seen **once** in a short history looks like a one-off. With 13
months of data containing a single $6,000 insurance premium, nothing else at
that merchant is 25 to 400 days away, so the premium is amortized to $600 a
year instead of counted at $6,000, and the baseline comes out low. It corrects
itself as soon as the second payment is in the history.

The opposite error is rarer: it needs two similar charges at one merchant 25
to 400 days apart that really are separate purchases, such as two cars from the
same dealer within thirteen months. Those get counted in the plain average,
which overstates spending: the safer direction for a retirement number, though
not a harmless one.

`SpendingBaseline.amortized` lists every purchase set aside, with its real and
annualized amounts, so the page can show what was treated as a one-off and the
reader can disagree.

## Rejected alternatives

- **Trailing 12 months** — simplest, and the number most people expect, but one
  year contains at most one of each lumpy cost and the FI number multiplies the
  luck.
- **Cap or trim the outliers** — see above; both delete real spending.
- **Amortize anything over the threshold** — the rent problem above.

## Cost if wrong

Nothing is stored: the baseline is derived from the transactions on every page
load, so a change to the window, the threshold, the life or the recurrence band
takes effect on the next load with no migration. The two constants are named
exports, and the recurrence band is three constants at the top of the module.
