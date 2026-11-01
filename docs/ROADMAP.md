# Saffron Wealth — Roadmap

**Last updated:** 2026-10-31 · **Current version:** v0.5

This is the sequenced source of truth for what gets built next. `README.md` describes what
exists today; this file describes what doesn't yet and in what order. When the two disagree,
the README is stale — fix it.

## How to read this

Three horizons, ordered by what unblocks what rather than by calendar date (this is a personal
project; dates would be fiction):

- **Now** — the active tier. Everything here unblocks something in Next.
- **Next** — the payoff tier. This is where the app stops being a tracker and starts being a planner.
- **Later** — real, wanted, not yet load-bearing.

Each item names its **prerequisite** where it has one, so the ordering is checkable rather than
asserted.

---

## Shipped

| Module | What it covers |
|---|---|
| **Auth foundation** | Email/password + Google OAuth, password reset, session management, rate limiting, audit log |
| **Monthly Budget** | Per-category monthly targets, Auto-Set from 12-month averages, color-coded progress, 80%/100% threshold alerts |
| **Cashflow forecast** | Budgeted income/expenses, projected net, per-category spend-rate extrapolation to month-end |
| **Transactions** | Add/delete, six-way filtering, server-side paging, Monarch CSV import with stable-ID dedup |
| **Net Worth** (Phases 1–3) | 12 account types across 5 buckets, current net worth, over-time chart with range selector, archive/restore, Monarch balance-history backfill |
| **Dark mode** | Light / System / Dark on the profile page, defaulting to the OS. Every colour is a theme token, so a new component gets both themes for free |
| **Financial Profile** (#1) | Declared planning inputs on `/financial-profile`: typed income streams, current and retirement age, real return / withdrawal / inflation assumptions, filing status, employer match, per-account contribution targets. Append-only dated versions |
| **FIRE calculator** (#4) | `/fire`: FI number, investable-portfolio progress, years to FI and Coast FI replayed against every rolling stretch of US market history since 1871 (five scenarios, percentile-band chart), spending baseline from the full transaction history in today's dollars, and sliders for the levers. Read-only; nothing persisted |

**Where that leaves us:** tracking is solid, all first-class financial data is persisted, and
the Financial Profile now has its first reader: the FIRE calculator turns the declared inputs, the
accounts and the full spending history into a years-to-FI answer. Net worth projections (#3) is
the next consumer, and the first that needs an *old* profile version. Everything below is about
extending the horizon from this answer to the rest of the plan — holdings, projections, loans,
and drawdown.

---

## Now

### 1. Financial Profile — ✅ shipped (v0.4)

Plan: `docs/saffron-wealth-financial-profile-plan.md`. Decisions:
`docs/decisions/0013-financial-profile-append-only-versions.md`,
`docs/decisions/0014-age-anchored-to-its-own-date.md`.

What shipped, against what this item asked for:

- **Income** — not one salary figure but a list of typed streams (salary, bonus, RSUs, ESPP,
  rental, self-employment, interest & dividends, other), each gross-annual with how it's paid.
  The kind is what lets #3/#4 separate earned from passive income later.
- **Age** — the user types their *current age*; it's stored as an anchor (age + the instant it
  was true) and derived forward, and the anchor only moves when the age is corrected (0014).
  No birth date is stored.
- **Target retirement age, expected real return, safe withdrawal rate, inflation** — required,
  with no pre-filled defaults.
- **Optional** — filing status, employer match (% of contributions up to % of salary), and
  annual contribution targets per cash / investment / retirement account.
- **Effective dating** — every changing save inserts a complete dated version; an unchanged save
  writes nothing (0013).

**Left for the first consumer:** a `getFinancialProfileAsOf(userId, date)` reader. Net worth
projections (#3) is the first thing that needs an old version, so it adds the reader; every
version it will read is already being kept.

### 2. Investment holdings

Accounts in the Investments and Retirement buckets carry a **balance only**. That's enough for
net worth and nothing else. A Boglehead-oriented app that can't tell you your asset allocation
is missing its own thesis.

- Positions under an account: ticker, shares, cost basis, acquisition date
- Derived asset allocation across the portfolio (not per account — allocation is a household-level
  question)
- Allocation drift vs. a target, which is the actual Boglehead action trigger
- Unrealized gain/loss

**Prerequisite:** none — this is additive to the existing `Account` model.

**Scope discipline:** no live price feed in the first pass. Manual share counts with a manual
price refresh keeps the dependency surface at zero and still answers the allocation question.
A quote provider can come later without a data-model change.

---

## Next

### 3. Net worth projections

**Prerequisite:** Financial Profile (#1).

Compound the existing net-worth series forward. The inputs are already in hand — a real
historical series from `lib/net-worth-history.ts` and a real spend history — plus the declared
return and savings assumptions from #1.

- Project forward on declared return + derived savings rate
- Show the projection as a continuation of the existing chart, visually distinct from actuals
- Scenario comparison: a few named assumption sets side by side, since a single line invites
  false confidence

### 4. FIRE calculator — ✅ shipped (v0.5)

Plan: `docs/saffron-wealth-fire-calculator-plan.md`. Decisions:
`docs/decisions/0015-fire-recentred-historical-sequences.md`,
`docs/decisions/0016-fire-spending-baseline.md`,
`docs/decisions/0017-fire-savings-from-profile-income.md`.

What shipped, against what this item asked for:

- **Savings rate** — income is the Financial Profile's declared gross, after an effective tax rate,
  less spending (0017), not a figure read off income transactions. The tax rate is pre-filled from
  what reached the bank when the history supports it and asked for otherwise. The savings-rate
  slider is a view of spending: raising it lowers spending, and the FI number with it.
- **FI number** — annual spending ÷ safe withdrawal rate. Spending is the average over every
  complete month of history, in today's dollars, with big one-offs spread over their useful life (0016).
- **Progress to FI** — the *investable* portfolio (cash, investments, retirement, less credit-card
  debt; no property or mortgage) as a share of the FI number. That is deliberately narrower than net worth.
- **Years to FI** — not a point estimate. Every complete rolling stretch of US stock and bond
  history since 1871 is replayed, recentred to the declared return, giving five scenarios and a
  percentile-band chart (0015).
- **Coast FI** — the portfolio needed today to reach the FI number by the target age without
  saving more, and the same historical replay for when that is crossed.
- **Sensitivity** — sliders for savings rate, tax rate, nominal return, inflation, withdrawal rate
  and stock allocation recompute everything live, with "Reset to defaults". Overrides are not saved.

**Left for later:** accumulation only — drawdown, Social Security and tax on withdrawal belong to
#6. Without holdings (#2) the allocation is one stock/bond slider for the whole portfolio, not the
user's actual mix. There is no side-by-side sensitivity grid.

### 5. Loan tracking

**Prerequisite:** rate and term fields on debt accounts.

`credit_card` and `loan_mortgage` accounts are currently just balances that happen to count
against net worth.

- Interest rate, term, and payment amount on debt accounts
- Amortization schedule and payoff date
- Interest paid to date and projected total interest
- Extra-payment what-ifs — the "invest vs. pay down the mortgage" question, which is a live
  Boglehead debate and worth answering with the user's own numbers

---

## Later

### 6. Retirement planning
**Prerequisite:** #1, #3, #4.
Withdrawal sequencing that respects account type (taxable → traditional → Roth), RMD modeling,
Social Security estimates, and the tax drag each choice implies. The account taxonomy already
distinguishes Traditional from Roth, which is the hard part of the data model.

### 7. Real estate detail
Purchase price, cost basis, capital improvements, market value vs. equity, and a link between a
`property` account and the `loan_mortgage` account that encumbers it. Today a property is one
number.

### 8. Cashflow reports
Multi-month and annual cashflow trends. The current Cashflow tab forecasts the month you're
standing in; this is the retrospective, multi-period view.

### 9. Goals
Named goals with target amounts and dates, linked to accounts or budget categories. Listed here
rather than in Next because the FIRE number is the goal that matters most, and #4 delivers it
without a general goals framework.

### 10. Budget expansion
- **Quarterly / semi-annual / annual periods** — `BudgetPeriod` in `lib/types.ts` and the period
  helpers in `lib/budget-utils.ts` already support these; only the UI doesn't expose them. Cheap.
- Cross-month carryover (rollover)
- Budget templates / recommended budgets

### 11. Alert delivery and persistence
Alerts are in-app only, and dismissals live in React state and reset on reload. Push/email
delivery plus a persisted dismissal record. Low stakes, hence low placement.

---

## Explicitly not doing

Recording these so they don't get re-litigated:

- **Direct bank aggregation** (Plaid and similar) — Monarch CSV export is the ingest path.
  Aggregation means credentials, ongoing cost, and a much larger security surface for a personal
  app that already has a working import.
- **Multi-currency** — single currency until there's a reason.
- **Multi-user / household sharing** — every model is scoped by `userId`, so this stays possible,
  but it isn't a goal.
- **Tax filing or tax-optimization engine** — retirement planning (#6) models tax *drag* on
  withdrawal decisions. It does not become tax software.
- **Commercial / multi-tenant productization** — this is a personal project built to learn and to
  be relied on by its author.

---

## Dependency summary

```
#1 Financial Profile ──┬──> #3 Net worth projections ──┐
                       ├──> #4 FIRE calculator ────────┼──> #6 Retirement planning
#2 Investment holdings ┘                               ┘

#5 Loan tracking     (independent — needs rate/term fields only)
#7 Real estate       (independent)
#8 Cashflow reports  (independent)
#10 Budget periods   (independent — data model already supports it)
```

Financial Profile was the single unlock for the entire planning tier, and it has shipped, and the
FIRE calculator (#4) is the first thing built on it. Net worth projections (#3) is next, and
retirement planning (#6) now waits only on that. Investment holdings (#2) is the remaining item
in Now; it would replace the calculator's single stock/bond slider with the real allocation.
