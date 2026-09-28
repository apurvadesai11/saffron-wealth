# Saffron Wealth — Roadmap

**Last updated:** 2026-09-27 · **Current version:** v0.3

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

**Where that leaves us:** tracking is solid and all first-class financial data is persisted.
Planning is one month deep — the cashflow forecast is the only forward-looking feature in the
app. Everything below is about extending the horizon from weeks to decades.

---

## Now

### 1. Financial Profile

**The blocking gap.** `User` currently holds identity and auth only — email, first/last name,
password hash, profile picture. There is no declared financial input anywhere in the app. Income
is *inferable* from income-category transactions, but nothing is *declared*, and every planning
feature below needs declared inputs.

Add a financial-profile surface (new section on `/profile`, or its own route) capturing:

- Gross annual income / salary, and how it's paid (for savings-rate math that doesn't have to
  reverse-engineer it from transactions)
- Birth date or target retirement age
- Expected real rate of return
- Safe withdrawal rate assumption
- Inflation assumption
- Optionally: filing status, employer match terms, contribution targets per account

**Why first:** projections, FIRE, and retirement planning are all arithmetic over these numbers.
Without them, each of those features would have to invent its own input form, and three features
would each own a different copy of "what return do you assume."

**Design note:** these are *assumptions*, not facts, and they change. Store them with an
effective date the way `AccountBalanceEvent` does, so a projection run last year stays
explicable. A single mutable row would make old numbers unreproducible.

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

### 4. FIRE calculator

**Prerequisite:** Financial Profile (#1). Better with Investment holdings (#2).

The feature the philosophy in the README has been promising. Everything it needs beyond #1
already exists.

- **Savings rate** — from income and expense history, which the app already has
- **FI number** — annual spend ÷ safe withdrawal rate
- **Progress to FI** — current net worth against that number
- **Years to FI** — under declared return and savings-rate assumptions
- **Coast FI** — the point where no further contributions are needed to hit the target by the
  target age
- **Sensitivity** — how years-to-FI moves with savings rate and return, because the sensitivity
  is more decision-relevant than the point estimate

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
- **Dark mode** — the `globals.css` dark-mode block was deliberately removed. Light mode only.
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

Financial Profile is the single unlock for the entire planning tier. It's also the smallest item
in Now.
