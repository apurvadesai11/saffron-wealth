# PRD: Monthly Budget Feature
## Saffron Wealth

**Product:** Saffron Wealth  
**Feature:** Monthly Budget  
**Status:** Draft  
**Author:** Apurva  
**Date:** February 2026

---

## 1. Problem Statement

Users of Saffron Wealth are reactive about their finances — they discover overspending or income shortfalls only after the fact, when the damage is already done. Without visibility into category-level spending limits, users fall into two harmful patterns: spending more than they earn, and failing to hit savings goals because discretionary spending goes unchecked.

The root issue is the absence of a pre-commitment mechanism. Users cannot set intentions for their monthly income and expenses before the month begins, and have no real-time signal when they are trending toward or beyond their financial limits. This gap between intention and awareness is what this feature is designed to close.

---

## 2. Goals & Outcomes

**Primary Goal:** Enable users to exercise pre-commitment budgeting so that monthly cash flow stays positive and savings goals are achievable.

**Desired Outcomes:**

- Users proactively set spending and income expectations before or at the start of each month
- Users receive timely, contextual alerts that prompt behavioral correction before limits are exceeded
- Users develop a habit of tracking actual vs. planned spend throughout the month, not just at month-end
- Reduction in month-over-month overspend events among users who activate the budget feature

**Out of Scope (v1):**
- Cross-month budget carryover (e.g., rollover of unspent budget)
- Budget templates or recommended budgets
- Goal-linked budget automation

---

## 3. Solution Overview

Saffron Wealth will introduce a Monthly Budget module that allows users to set a budget for each income and expense category. The feature operates across four surfaces: **setup**, **auto-set**, **tracking**, and **alerting**.

**Setup:** When configuring a budget for a category, the user is shown the historical average monthly spend for that category (last 12 months) as a reference point. They enter a budget amount (including $0 as a valid input). Once set, the budget applies to the current month and all future months unless the user updates it. Categories with a $0 budget are labeled **"Hidden from Budgets"** and display no progress bar.

**Auto-Set All Budgets:** A single action that automatically populates every category's budget using its 12-month historical average. Users can review and adjust individual categories after auto-set is applied. This is the recommended path for first-time setup.

**Tracking:** As transactions are recorded throughout the month, each budgeted category displays a color-coded visual progress bar showing actual spend or income received vs. the monthly budget.

*Expense category bar states:*

| Threshold | Bar Color |
|---|---|
| < 80% spent | Green |
| ≥ 80% spent | Yellow |
| ≥ 100% spent | Red |
| > 100% spent | Deep red |

*Income category bar states (inverse model — reflects how much of expected income has been received):*

| Threshold | Bar Color |
|---|---|
| < 50% received | Red |
| ≥ 50% received | Orange |
| ≥ 80% received | Yellow |
| ≥ 100% received | Green |

**Alerting:** In-app alerts apply to expense categories only, firing at two thresholds per category per month. Each alert includes the category name, amount spent to date, remaining budget, and days remaining in the current month.

| Threshold | Alert Message |
|---|---|
| ≥ 80% spent | "You've used [X]% of your [Category] budget. $[remaining] left with [N] days to go." |
| ≥ 100% spent | "You've reached your [Category] budget. You're $[amount] over with [N] days remaining." |

**Aggregate Cashflow View:** A display-only summary header above the category list shows total budgeted income vs. total budgeted expenses for the month, with a projected net (surplus or deficit). This updates in real time as transactions are recorded and requires no additional configuration.

---

## 4. User Personas

**Primary Persona: The Financially Aware Consumer**

A working adult with regular income and recurring monthly expenses who wants to be more intentional about spending but lacks the financial expertise to build or maintain complex budget systems. They are comfortable using web applications but are not financial power users. They respond well to visual cues and timely nudges. They want the platform to do the hard work of tracking — they just want to set it and be told when something needs attention.

Key characteristics:
- Limited formal financial knowledge
- Motivated by goals (savings targets, avoiding debt) rather than financial theory
- Susceptible to lifestyle creep without visibility
- More likely to correct behavior when alerted early vs. after the fact

---

## 5. Functional Requirements

### Budget Management
- FR-01: Users can set a monthly budget amount for any income or expense category present in their Saffron Wealth account
- FR-02: When opening the budget-setting UI for a category, users are shown the historical average monthly spend for that category (calculated from the last 12 months of transaction history, or all available history if less than 12 months of data exists)
- FR-03: Users can update a budget for any category at any time
- FR-04: When a budget is set or updated, it applies to the current month and all subsequent months going forward (it does not retroactively change past months)
- FR-05: $0 is a valid budget value for any category; categories with a $0 budget are labeled "Hidden from Budgets" and display no progress bar
- FR-06: A category without a budget set displays no budget bar or threshold indicators
- FR-07: Users can trigger "Auto-Set All Budgets," which automatically sets each category's budget to its 12-month historical average in a single action; users may adjust individual categories after auto-set is applied

### Budget Tracking — Expense Categories
- FR-08: Each budgeted expense category displays a visual progress bar showing actual spend vs. the monthly budget
- FR-09: The progress bar reflects all transactions recorded for the current calendar month
- FR-10: Progress bars update in real time (or near real time) as new transactions are added or edited
- FR-11: Expense progress bars follow these color states: Green (< 80% spent), Yellow (≥ 80%), Red (≥ 100%), Deep red (> 100%)

### Budget Tracking — Income Categories
- FR-12: Each budgeted income category displays a visual progress bar showing income received vs. the monthly budget
- FR-13: Income progress bars follow an inverse color model reflecting how much of expected income has been received: Red (< 50% received), Orange (≥ 50%), Yellow (≥ 80%), Green (≥ 100%)
- FR-14: Income category bars carry no alert behavior in v1

### Alerting (Expense Categories Only)
- FR-15: When an expense category's actual spend reaches 80% of its monthly budget, an in-app notification is triggered; the notification includes: category name, % spent, remaining dollar amount, and days remaining in the current month
- FR-16: When an expense category's actual spend reaches 100% of its monthly budget, a second in-app notification is triggered; the notification includes: category name, overage amount, and days remaining in the current month
- FR-17: When an expense category exceeds 100% of its monthly budget, the bar turns deep red; no additional notification is sent beyond the 100% alert
- FR-18: Alert notifications are displayed within the application (push or email notifications are out of scope for v1)
- FR-19: Each threshold alert fires once per category per month at each threshold; if a budget is subsequently increased such that the user drops below a previously-triggered threshold, that alert resets and may re-fire if the threshold is crossed again; if a budget is decreased such that current spend immediately crosses a threshold, the alert fires at the time of the update

### Aggregate Cashflow View
- FR-20: A display-only summary header above the category list shows: total budgeted income for the month, total budgeted expenses for the month, and a projected end-of-month net (surplus or deficit)
- FR-21: The projected end-of-month net is calculated as follows: (a) for expenses, each category's current spend rate (amount spent to date ÷ days elapsed) is extrapolated to month-end on a per-category basis, then summed; (b) for income, budgeted income is used as the target regardless of income received to date; projected net = budgeted income minus projected total expenses
- FR-22: The aggregate view reflects actual transactions to date and updates in real time
- FR-23: The aggregate view requires no user configuration beyond setting individual category budgets
- FR-24: On day 1 of the month (or when no transactions have been recorded yet), the projected net defaults to the static budget view (total budgeted income minus total budgeted expenses) until sufficient data exists to calculate a rate

---

## 6. User Stories

### Story Set 1: First-Time Budgeter Setting Up a Budget

**US-01: Auto-set all budgets from historical averages**
> As a first-time user of the budget feature, I want to set all my category budgets at once using my spending history, so that I have a complete starting budget without having to configure each category manually.

*Acceptance Criteria:*
- An "Auto-Set All Budgets" action is available on the budget overview screen
- Triggering it sets every category's budget to its 12-month historical average in a single action
- After auto-set, I can review and edit any individual category's budget
- Categories with no transaction history receive no budget (they remain unset)

**US-02: View historical spend context before setting a budget**
> As a user setting a budget for the first time, I want to see my average monthly spend for a category before I enter a budget amount, so that I can set a realistic target rather than guessing.

*Acceptance Criteria:*
- When I open the budget-setting interface for a category, I see the historical average monthly spend (last 12 months) displayed before I enter a value
- If there is insufficient history (fewer than 2 months of data), the UI displays a message indicating limited history is available
- The historical average is read-only and cannot be edited

**US-03: Set a budget for a category**
> As a user, I want to enter a monthly budget amount for an income or expense category, so that I have a pre-committed spending or income target for the month.

*Acceptance Criteria:*
- I can enter any non-negative dollar amount, including $0
- After saving, the budget is immediately reflected in the category view with a progress bar (unless $0, which shows "Hidden from Budgets")
- The budget applies to the current month and all future months

**US-04: Hide a category from budgets**
> As a user, I want to set a $0 budget for a category to indicate I don't want to track or spend in it, so that it's clearly marked as out of scope for my budget.

*Acceptance Criteria:*
- $0 is accepted as a valid input
- A category with a $0 budget displays the label "Hidden from Budgets" instead of a progress bar
- The "Hidden from Budgets" label is visually distinct from unset categories

---

### Story Set 2: Returning User Reviewing Budget Mid-Month

**US-05: Track progress across all categories at a glance**
> As a returning user checking in mid-month, I want to see all my budgeted categories and their current spend at a glance, so that I can quickly identify where I'm on track and where I need to course correct.

*Acceptance Criteria:*
- A budget overview screen shows all categories with active budgets
- Each category displays: budget amount, amount spent or received to date, remaining budget, and a color-coded progress bar
- Expense categories exceeding 80% are visually distinct (yellow, red, deep red) from those on track (green)
- Income categories below 100% received are visually distinct (red, orange, yellow) from those on track (green)
- "Hidden from Budgets" categories are shown with that label; unset categories are not shown

**US-06: View aggregate cashflow summary**
> As a returning user, I want to see my total budgeted income vs. projected end-of-month expenses in one place, so that I can assess whether I'm on track to be cashflow positive by month-end.

*Acceptance Criteria:*
- A summary header above the category list shows: total budgeted income, total budgeted expenses, and projected end-of-month net (surplus or deficit)
- The projected net is calculated per expense category using each category's spend rate (spend to date ÷ days elapsed), extrapolated to month-end, then summed; income uses budgeted income as the fixed target
- On day 1 or when no transactions exist yet, the projection defaults to static budget amounts (budgeted income minus budgeted expenses)
- The summary updates in real time as transactions are recorded
- No additional configuration is required to see this view

**US-07: Receive a contextual alert when approaching a budget limit**
> As a user, I want to receive an in-app alert when I've reached 80% of an expense category's budget, including how much I have left and how many days remain, so that I can make informed decisions about my remaining spending.

*Acceptance Criteria:*
- An in-app notification fires when the 80% threshold is crossed for a given expense category
- The notification includes: category name, percentage spent, remaining dollar amount, and days remaining in the current month
- The alert fires only once per category per month at the 80% threshold (subject to reset rules in US-08)

**US-08: Update a budget mid-month**
> As a returning user, I want to update my budget for a category mid-month, so that I can adjust my targets if my financial situation changes.

*Acceptance Criteria:*
- I can edit the budget for any category at any time
- The updated budget applies immediately to the current month's progress bar and threshold calculations
- If the budget is increased such that I drop below a previously-triggered threshold, that alert resets and will re-fire if the threshold is crossed again
- If the budget is decreased such that my current spend immediately crosses a threshold, the appropriate alert fires at the time of the update

---

## 7. Success Metrics

### Adoption
- **Budget Activation Rate:** % of active users who set at least one category budget within 30 days of feature launch — target: 40%
- **Auto-Set Usage Rate:** % of first-time budget activations that use "Auto-Set All Budgets" vs. manual setup — target: 60% (indicates the friction-reduction mechanism is working)
- **Category Coverage:** Average number of categories budgeted per active budget user — target: 3+ categories

### Engagement
- **Monthly Return Rate:** % of budget users who view the budget overview screen at least twice per month — target: 60%
- **Alert Engagement Rate:** % of 80% threshold alerts that result in the user opening the app within 24 hours — target: 35%
- **Cashflow View Engagement:** % of budget users who scroll to or interact with the aggregate cashflow summary at least once per month — target: 50%

### Behavioral Outcomes
- **Overspend Reduction:** Month-over-month reduction in categories that exceed budget among users who activate the feature vs. control group — target: 20% reduction at 90 days
- **Budget Update Rate:** % of users who update at least one budget after initial setup — target: 25% (indicates users are treating budget as a living tool, not set-and-forget)

### Quality
- **Alert False Positive Rate:** % of alerts that fire at incorrect thresholds due to calculation errors — target: 0%
- **Budget Persistence Accuracy:** % of months where budget correctly carries forward from prior month without user action — target: 100%
