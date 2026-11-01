# 0017 — FIRE savings are the profile's gross income after a tax rate, minus spending; the rate is pre-filled from the bank

**Status:** Accepted · **Origin:** FIRE calculator plan (roadmap #4)
**Code:** `buildFireInputs`, `computeTakeHome`, `payrollDeductions`, `employerMatchAmount` and `deriveEffectiveTaxRatePct` in `lib/fire-inputs.ts`

## Decision

The projection's yearly savings is

```
savings = grossIncome × (1 − t) − annualSpending
```

`grossIncome` is the total of the Financial Profile's declared income streams.
`annualSpending` is the baseline from decision 0016. `t` is a tax-rate lever
that the page pre-fills from the transactions when they support it.

The pre-fill is derived, not assumed:

```
t = 1 − (takeHome + payrollDeductions) / cashIncome        (percent, 1 dp)
```

- **`takeHome`** is the income transactions of the last 12 complete months
  before `asOf`'s month, but not before the spending baseline's first month,
  annualized (`Σ / months × 12`). It is `null` below 6 months of history.
- **`payrollDeductions`** is the profile's yearly contribution targets on
  401(k), Roth 401(k), HSA and ESPP accounts, the ones filled from the paycheck
  before it is deposited. The account type is looked up among active **and
  archived** accounts, since a target can still name an account archived after
  the profile was saved.
- **`cashIncome`** is the profile's salary, bonus, rental, self-employment and
  "other" streams. RSUs, ESPP and interest/dividends are left out.
- The result is `null` (no pre-fill) when there is no take-home, when
  `cashIncome` is not positive, or when the rounded result is outside **0 to
  60**.

The employer match is returned as its own figure: `matchPct`% of the user's
401(k) and Roth 401(k) targets, capped at `limitPct`% of **salary** streams.
It is never in the paycheck or the bank, so it belongs in neither `grossIncome`
nor `takeHome`.

## Why gross × (1 − t), not gross − spending

Gross minus spending counts the tax bill as savings. On $150,000 of income at a
24% effective rate and $60,000 of spending, it says $90,000 a year goes into the
portfolio when $54,000 does (150,000 × 0.76 − 60,000), an overstatement of
exactly the tax, two-thirds on top of the real figure. A retirement date built
on that is years too early, and the error is in the flattering direction.

## Why the income is the profile's, not the transactions'

Take-home from the transactions is what reached the bank, and it is not the
income the plan needs:

- It already has the 401(k), HSA and ESPP contributions taken out, and those are
  the savings the plan is trying to measure.
- It has no RSUs, which arrive as shares with the tax withheld by selling some.
- It describes the past. The profile is what the user says income is *now*, and
  a raise or a new job shows up in it the day it is saved.

So the profile supplies the size of the income and the transactions supply only
a ratio: how much of it, in practice, is kept.

## Why add the payroll deductions back

Without the add-back, a 401(k) contribution looks like tax. Take-home of $90,000
against $150,000 of cash income reads as 40% gone, when $24,000 of that went
into a 401(k) and an HSA and the rest, 24%, is tax. Adding the deductions back
makes `takeHome + payrollDeductions` the pay that survives tax, which is what
`× (1 − t)` has to reproduce. The targets are declared yearly amounts, so this
takes the profile's word for them; a contribution changed mid-window will skew
the rate by the change.

## Why RSU and interest/dividend income are left out of the rate

`cashIncome` is the income that *could* have reached the bank. RSUs vest as
shares, and the tax is paid by withholding part of them, so no deposit appears
in the transactions. Counting $50,000 of RSUs in the denominator while none of
it is in the numerator turns a 24% rate into 43%. ESPP is a
payroll purchase into an account, with the same problem. Interest and dividends
are paid into the account that earned them and are rarely a transaction at all.

The rate that comes out is then applied to **all** gross income, RSUs included.
That is an approximation (RSU withholding is often at a flat supplemental rate
that differs from the salary's effective rate), and the lever is there to
correct it.

## Why no pre-fill outside 0 to 60

A derived rate outside 0 to 60 is almost never a tax rate. Below zero, the bank
received more than the profile says was earned: a stream is missing from the
profile, or the income transactions include something that isn't pay. Above 60,
the reverse: the profile claims more cash income than arrived, because the
history spans a job change or a stream is overstated. Either way the number
measures a disagreement between the two sources, and pre-filling it would put a
confident, wrong figure under the whole projection. No pre-fill is offered; the
user enters a rate.

The check is on the value rounded to one decimal, so a rate that rounds to 60.0
is offered and one that rounds to 60.1 is not.

## Why a 12-month window, no less than 6 months

Spending uses the full history because it is lumpy and the FI number multiplies
its noise (decision 0016). Take-home is the opposite: regular, and tied to the
current job and tax regime. Five years ago's pay is a different life, so the
window is the most recent 12 complete months, which also covers an annual
bonus exactly once. It stops at the spending baseline's first month so income
and spending describe the same stretch, and so a first import month (rarely
whole) is not averaged in on one side only.

Take-home is not restated to today's dollars. It is divided by a gross figure
declared in today's dollars, over at most 12 months, so both sides of the ratio
are already current.

With less than 12 months the average is annualized (`× 12 / months`), which
over-weights a bonus that happens to fall inside. Below 6 months that risk is
too large to pre-fill from, so the result is `null`.

## Known blind spots

- **Tax paid outside the paycheck.** Self-employment estimates and an April
  balance due are expenses in the transactions, not deductions from take-home, so
  the derived rate comes out low for anyone who pays that way.
- **Undeclared or mis-sized income.** Income in the bank that the profile doesn't
  list pushes the rate down; a salary stated higher than the real one pushes it up.
  The 0 to 60 bounds catch the large cases, not the small ones.
- **Non-pay income transactions.** Refunds and reimbursements filed as income
  inflate take-home and lower the rate.

`TakeHome.months` travels with the rate, so whatever shows it can say how much
history it rests on, and it is only ever a starting value for the user to
overtype.

## Rejected alternatives

- **Gross minus spending** — counts taxes as savings; see above.
- **Savings from the transactions** (income minus expenses, historically) —
  needs no tax rate, but it is the past rather than the profile's plan, it has no
  RSUs, and it treats payroll contributions as spending nothing.
- **A tax calculator from brackets** — needs yearly federal and per-state tables
  kept current, a filing status the profile only optionally has, and deductions
  the app doesn't know. The transactions already hold the answer, including the
  state tax, FICA and pre-tax benefits a bracket table would miss.
- **A fixed default rate** — a number the user didn't give and the data
  doesn't support, in the one input that every dollar of savings is multiplied by.

## Cost if wrong

Nothing is stored. The inputs are derived from the profile, accounts and
transactions on every page load, so a change to the window, the 6-month minimum,
the 0 to 60 range or the payroll and cash-income sets takes effect on the next
load with no migration. Each is a named constant at the top of
`lib/fire-inputs.ts`.
