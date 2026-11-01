# 0015 — FIRE projections replay real historical return sequences, recentred in log space to the declared return

**Status:** Accepted · **Origin:** FIRE calculator plan (roadmap #4)
**Code:** `blendReturns`, `recenterReturns`, `horizonYears`, `simulateWindows` and `summarize` in `lib/fire-simulation.ts`

## Decision

Years to FI and Coast FI are found by replaying **every complete rolling
window** of the annual real-return table in `lib/market-history-data.ts` (US
stocks and 10-year Treasuries, 1871 to 2025) against the user's portfolio,
contribution and FI number, and reporting the spread of outcomes.

1. **Blend.** Each year's return is `w·stocks + (1 − w)·bonds`, rebalanced
   annually to the stock allocation `w`.
2. **Recentre.** The blended series is shifted so its **geometric** mean equals
   the real return the user declared:
   `ln(1 + r′) = ln(1 + r) − mean(ln(1 + r)) + ln(1 + target)`. The sequence,
   the dispersion and every year-to-year ratio are history's; the level is the
   user's.
3. **Complete windows only.** A window starts at every year that has `horizon`
   years of history after it, and nothing wraps around. `horizon` is the years to
   the target retirement age, kept between 40 and 70 (`horizonYears`). At 40
   years that is 116 windows; at 70, 86.
4. **Step with mid-year contributions.** `P[k+1] = P[k]·(1 + r) + C·√(1 + r)`,
   in real dollars, with `C` constant.
5. **Accumulation only.** A window ends where the portfolio reaches the FI
   number; nothing is withdrawn.

Years to FI interpolates linearly inside the year the balance crosses. Coast FI
is the first year in which the balance, left to grow on that window's own
returns, reaches the FI number by the target age. The summary reports the best,
10th-percentile, median, 90th-percentile and worst window by nearest rank, and
10th, 50th and 90th percentile bands of the balance for the chart.

## Why history, not Monte Carlo

A Monte Carlo run needs a return distribution, and the honest options are all
assumptions the user cannot check: a normal or lognormal draw has no fat tails,
no 1929 or 1973, and no memory between years, and its volatility and
stock/bond correlation are two more numbers to invent. It would also be
different every render unless seeded.

History is one fixed, inspectable set of paths that really happened, in the order
they happened. Every ranked row carries the start year of its window, so "the
worst case is the sequence that began in 1960" is a statement a person can look
up and argue with. A simulated percentile has no such year to point at.

The cost is honesty about what the windows are. Consecutive 40-year windows share
39 of their 40 years, so 116 of them are closer to four independent periods than
to 116 samples. The percentiles describe history; they are not probabilities
about the future, and the page does not present them as such.

## Why recentre, and why in log space

Left raw, the table's all-stock real return is 7.1% a year (geometric). The user
declared a return, and that slider has to move the answer; the profile also
states one. History is used for what the user has no number for, which is how
bumpy the road is and in what order, not for the level.

The level has to be matched on the **geometric** mean, because that is the
quantity that compounds: `Π(1 + r)` is what a portfolio is multiplied by. The
simpler fix is an arithmetic shift, adding `target − mean(r)` to every year, and
it is wrong by the volatility drag. The all-stock series has an arithmetic mean
of 8.6%, a geometric mean of 7.1% and a standard deviation of 17.8%, and the
gap is σ²/2 (1.6 points). Shifting that series arithmetically to a 5% target
would leave the typical path compounding at about 3.4%. The user would be told
their 5% plan and shown a 3.4% one, with the shortfall growing with the stock
allocation.

Shifting `ln(1 + r)` by a constant multiplies every year by the same factor, so
the ratios between years survive (a bad year stays exactly as much worse than a
good one as it was) and `Π(1 + r′) = (1 + target)^n` holds exactly. The recentre is computed
on the whole table, once, before windowing; each window then has its own geometric
mean, scattered around the target, which is the spread the percentiles report.

## Why complete windows, and why 40 to 70 years

Wrapping the table around (a window starting in 2000 continuing into 1871)
splices a sequence that never happened: 2025 followed by 1871. Shorter windows
at the end of the table would put different horizons in one ranking. Dropping
what does not fit keeps every window the same length and every percentile a
statement about the same question.

The price is that the edges of the table are under-used: 1871's return appears in
one window and 2025's in one, where a year in the middle appears in forty.
Wrap-around would weight every year equally, at the cost of the invented
sequence. That is the trade, and it favours real sequences.

The bounds trade window count against reach. The horizon is not the target age
itself, because a slow window can reach FI after the target age, and with a
target only a few years away a horizon that short would report those as "never"
when they are merely slow; forty years leaves room for them to land on a number.
Above 70 years the table leaves fewer than 86 windows, which are nearly all the
same few decades, and few people plan that far. Within the bounds the horizon
follows the target age, so someone planning to retire in 45 years sees 45.

`simulateWindows` throws when it is handed fewer years of returns than the
horizon. `horizonYears` caps the horizon so the real table (155 years) always
covers it, which makes that a programming error and not something a user can
reach.

## Why contributions arrive mid-year

Savings land throughout a year, not on 1 January or 31 December. A deposit at
the start would earn all of that year's return and one at the end none of it. The
contribution is treated as arriving at the midpoint and growing for half a year,
by `√(1 + r)`, which is exact for money that earns a steady rate within the year.
Start-of-year would make every plan look a little faster, end-of-year a little
slower, and both bias in the same direction every year.

## Why accumulation only

The question the page answers is "how long until the portfolio is big enough?".
Whether it then lasts is the safe-withdrawal-rate's job, and that rate is already
a lever the user sets. Simulating withdrawals as well would answer a second
question with the same table, add a retirement length and a spending path
as new assumptions, and make "years to FI" depend on how the drawdown is
modelled. A window therefore stops at FI. Contributions and spending are held
constant in real dollars: no raises, no windfalls.

## Rejected alternatives

- **Monte Carlo** — see above: an invented distribution in place of a real
  record, with false precision.
- **Raw, unrecentred history** — the return slider would do nothing.
- **Arithmetic recentring** — the drag problem above.
- **Wrap-around or shorter end windows** — see above.
- **Bootstrapping years at random from the table** — a middle path, but it
  destroys the order, and order is what makes 1966 to 1982 different from 1982 to
  2000 for someone who is still contributing.

## Cost if wrong

Nothing is stored. The table is a module constant and the whole simulation over it
takes about two milliseconds, so changing the horizon bounds, the scenario
percentiles or the contribution timing takes effect on the next load with no
migration. The horizon bounds are the two named exports `MIN_HORIZON_YEARS` and
`MAX_HORIZON_YEARS`, and the five scenario ranks sit in one table in
`lib/fire-simulation.ts`.
