# Saffron Wealth — Roadmap

**Last updated:** 2026-10-31 · **Current version:** v0.4

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

**Where that leaves us:** tracking is solid and all first-class financial data is persisted.
The declared inputs planning needs now exist, but nothing reads them yet — the cashflow forecast
is still the only forward-looking feature in the app. Everything below is about extending the
horizon from weeks to decades.

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

Financial Profile was the single unlock for the entire planning tier, and it has shipped —
#3 and #4 are unblocked. Investment holdings (#2) is the remaining item in Now.
