# Saffron Wealth

A personal budget and expense tracking app built to close the gap between financial intention and real-time awareness. Set monthly budgets, track spending with color-coded progress bars, and receive contextual alerts before you overspend.

## Features

- **Pre-commitment budgeting** — Set monthly budget targets for income and expense categories
- **Auto-Set All** — Populate budgets from 12-month historical spending averages in one click
- **Color-coded progress bars** — Green/yellow/red/deep-red for expenses; inverse model for income tracking
- **Threshold alerts** — In-app notifications at 80% and 100% of expense budgets with remaining dollars and days
- **Transaction management** — Add and delete transactions with automatic budget recalculation
- **Month navigation** — Review budget performance for any past or future month
- **Cashflow tab** — Spending-by-category breakdown with visual bars

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript (strict mode) |
| UI | React 19, Tailwind CSS 4 |
| Deployment | Vercel |

No backend or database — v1 is fully client-side with in-memory state seeded from mock data.

## Project Structure

```
app/
  page.tsx          Main page: transactions, budget + cashflow tabs, alerts
  layout.tsx        Root layout with font and metadata
  providers.tsx     Client component shim for React Context
  error.tsx         Error boundary
  globals.css       Tailwind imports and theme variables
components/
  AlertBanner.tsx        Single alert notification (80% or 100%)
  AlertPanel.tsx         Container that sorts and renders alerts
  BudgetCategoryList.tsx Section renderer (Expenses / Income)
  BudgetCategoryRow.tsx  Category row with progress bar and amounts
  BudgetEditModal.tsx    Modal for setting/editing budget amounts
  BudgetProgressBar.tsx  Color-coded progress indicator
  CashflowCard.tsx       Cashflow projection card (available, not currently rendered)
lib/
  types.ts          TypeScript interfaces and type definitions
  budget-utils.ts   Pure business logic (spend calc, alerts, projections)
  app-context.tsx   React Context provider for shared state
  mock-data.ts      Seed data: categories, transactions, budgets
docs/
  saffron-wealth-monthly-budget-prd.md   Product requirements and implementation log
```

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm run start` | Serve production build |
| `npm run lint` | Run ESLint |
