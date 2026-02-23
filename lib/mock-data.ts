import { Category, Transaction, Budget } from './types';

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const MOCK_CATEGORIES: Category[] = [
  // Expense categories
  { id: 'housing',       name: 'Housing',       type: 'expense', color: 'bg-violet-500' },
  { id: 'groceries',     name: 'Groceries',     type: 'expense', color: 'bg-orange-400' },
  { id: 'dining',        name: 'Dining Out',    type: 'expense', color: 'bg-yellow-500' },
  { id: 'transport',     name: 'Transport',     type: 'expense', color: 'bg-blue-400'   },
  { id: 'entertainment', name: 'Entertainment', type: 'expense', color: 'bg-pink-400'   },
  { id: 'utilities',     name: 'Utilities',     type: 'expense', color: 'bg-cyan-500'   },
  { id: 'other',         name: 'Other',         type: 'expense', color: 'bg-gray-400'   },
  // Income categories
  { id: 'salary',        name: 'Salary',        type: 'income',  color: 'bg-green-500'  },
  { id: 'freelance',     name: 'Freelance',     type: 'income',  color: 'bg-emerald-400'},
];

// ---------------------------------------------------------------------------
// Transactions — 4 months of history to power historical averages
// ---------------------------------------------------------------------------
//
// February 2026 (current month, partial through ~day 14) is designed to
// demonstrate every progress bar state:
//
//   Housing       $1,600 / $1,600  = 100%    → red        (exactly at budget)
//   Groceries       $180 / $400    =  45%    → green
//   Dining Out      $112 / $200    =  56%    → green
//   Transport       $122 / $150    =  81.3%  → yellow     (approaching limit)
//   Entertainment   $123 / $100    = 123%    → deep-red   (over budget)
//   Utilities       $130 / $200    =  65%    → green
//   Salary        $4,500 / $4,500  = 100%    → green      (income, fully received)
//   Freelance       $400 / $800    =  50%    → orange     (income, half received)

export const MOCK_TRANSACTIONS: Transaction[] = [

  // ── February 2026 ──────────────────────────────────────────────────────────
  { id: 201, description: 'Rent',               amount: 1600, categoryId: 'housing',       type: 'expense', date: '2026-02-01' },
  { id: 202, description: 'Salary',             amount: 4500, categoryId: 'salary',        type: 'income',  date: '2026-02-01' },
  { id: 203, description: 'Whole Foods',        amount:   95, categoryId: 'groceries',     type: 'expense', date: '2026-02-03' },
  { id: 204, description: 'Electric bill',      amount:   85, categoryId: 'utilities',     type: 'expense', date: '2026-02-04' },
  { id: 205, description: 'Uber Eats',          amount:   45, categoryId: 'dining',        type: 'expense', date: '2026-02-05' },
  { id: 206, description: 'Train pass',         amount:   80, categoryId: 'transport',     type: 'expense', date: '2026-02-06' },
  { id: 207, description: 'Spotify',            amount:   15, categoryId: 'entertainment', type: 'expense', date: '2026-02-07' },
  { id: 208, description: 'Trader Joe\'s',      amount:   85, categoryId: 'groceries',     type: 'expense', date: '2026-02-09' },
  { id: 209, description: 'Coffee shop x4',     amount:   32, categoryId: 'dining',        type: 'expense', date: '2026-02-10' },
  { id: 210, description: 'Gas bill',           amount:   45, categoryId: 'utilities',     type: 'expense', date: '2026-02-11' },
  { id: 211, description: 'Freelance — client A', amount: 400, categoryId: 'freelance',   type: 'income',  date: '2026-02-12' },
  { id: 212, description: 'Netflix',            amount:   18, categoryId: 'entertainment', type: 'expense', date: '2026-02-12' },
  { id: 213, description: 'Lyft',               amount:   42, categoryId: 'transport',     type: 'expense', date: '2026-02-13' },
  { id: 214, description: 'Concert tickets',    amount:   90, categoryId: 'entertainment', type: 'expense', date: '2026-02-14' },
  { id: 215, description: 'Dinner — anniversary', amount: 35, categoryId: 'dining',       type: 'expense', date: '2026-02-14' },

  // ── January 2026 ──────────────────────────────────────────────────────────
  { id: 101, description: 'Rent',               amount: 1600, categoryId: 'housing',       type: 'expense', date: '2026-01-01' },
  { id: 102, description: 'Salary',             amount: 4500, categoryId: 'salary',        type: 'income',  date: '2026-01-01' },
  { id: 103, description: 'Whole Foods',        amount:  110, categoryId: 'groceries',     type: 'expense', date: '2026-01-05' },
  { id: 104, description: 'Electric bill',      amount:   90, categoryId: 'utilities',     type: 'expense', date: '2026-01-06' },
  { id: 105, description: 'Trader Joe\'s',      amount:  105, categoryId: 'groceries',     type: 'expense', date: '2026-01-12' },
  { id: 106, description: 'Train pass',         amount:  120, categoryId: 'transport',     type: 'expense', date: '2026-01-03' },
  { id: 107, description: 'Netflix',            amount:   18, categoryId: 'entertainment', type: 'expense', date: '2026-01-08' },
  { id: 108, description: 'Concert tickets',    amount:  210, categoryId: 'entertainment', type: 'expense', date: '2026-01-20' },
  { id: 109, description: 'Freelance — client B', amount: 600, categoryId: 'freelance',   type: 'income',  date: '2026-01-15' },
  { id: 110, description: 'Gas bill',           amount:   50, categoryId: 'utilities',     type: 'expense', date: '2026-01-14' },
  { id: 111, description: 'Uber Eats',          amount:   55, categoryId: 'dining',        type: 'expense', date: '2026-01-10' },
  { id: 112, description: 'Sushi restaurant',   amount:   80, categoryId: 'dining',        type: 'expense', date: '2026-01-24' },
  { id: 113, description: 'Spotify',            amount:   15, categoryId: 'entertainment', type: 'expense', date: '2026-01-08' },
  { id: 114, description: 'Lyft rides',         amount:   35, categoryId: 'transport',     type: 'expense', date: '2026-01-18' },

  // ── December 2025 ─────────────────────────────────────────────────────────
  { id:  51, description: 'Rent',               amount: 1600, categoryId: 'housing',       type: 'expense', date: '2025-12-01' },
  { id:  52, description: 'Salary',             amount: 4500, categoryId: 'salary',        type: 'income',  date: '2025-12-01' },
  { id:  53, description: 'Whole Foods',        amount:   95, categoryId: 'groceries',     type: 'expense', date: '2025-12-06' },
  { id:  54, description: 'Holiday groceries',  amount:  140, categoryId: 'groceries',     type: 'expense', date: '2025-12-20' },
  { id:  55, description: 'Electric bill',      amount:  105, categoryId: 'utilities',     type: 'expense', date: '2025-12-07' },
  { id:  56, description: 'Gas bill',           amount:   55, categoryId: 'utilities',     type: 'expense', date: '2025-12-14' },
  { id:  57, description: 'Train pass',         amount:  120, categoryId: 'transport',     type: 'expense', date: '2025-12-03' },
  { id:  58, description: 'Netflix',            amount:   18, categoryId: 'entertainment', type: 'expense', date: '2025-12-08' },
  { id:  59, description: 'Holiday gifts',      amount:  180, categoryId: 'entertainment', type: 'expense', date: '2025-12-22' },
  { id:  60, description: 'Spotify',            amount:   15, categoryId: 'entertainment', type: 'expense', date: '2025-12-08' },
  { id:  61, description: 'Holiday dinner',     amount:   95, categoryId: 'dining',        type: 'expense', date: '2025-12-25' },
  { id:  62, description: 'Uber Eats',          amount:   40, categoryId: 'dining',        type: 'expense', date: '2025-12-11' },
  { id:  63, description: 'Freelance — year-end', amount: 900, categoryId: 'freelance',   type: 'income',  date: '2025-12-30' },

  // ── November 2025 ─────────────────────────────────────────────────────────
  { id:   1, description: 'Rent',               amount: 1600, categoryId: 'housing',       type: 'expense', date: '2025-11-01' },
  { id:   2, description: 'Salary',             amount: 4500, categoryId: 'salary',        type: 'income',  date: '2025-11-01' },
  { id:   3, description: 'Whole Foods',        amount:  100, categoryId: 'groceries',     type: 'expense', date: '2025-11-05' },
  { id:   4, description: 'Trader Joe\'s',      amount:   90, categoryId: 'groceries',     type: 'expense', date: '2025-11-15' },
  { id:   5, description: 'Electric bill',      amount:   80, categoryId: 'utilities',     type: 'expense', date: '2025-11-07' },
  { id:   6, description: 'Gas bill',           amount:   45, categoryId: 'utilities',     type: 'expense', date: '2025-11-14' },
  { id:   7, description: 'Train pass',         amount:  120, categoryId: 'transport',     type: 'expense', date: '2025-11-03' },
  { id:   8, description: 'Netflix',            amount:   18, categoryId: 'entertainment', type: 'expense', date: '2025-11-08' },
  { id:   9, description: 'Spotify',            amount:   15, categoryId: 'entertainment', type: 'expense', date: '2025-11-08' },
  { id:  10, description: 'Movie tickets',      amount:   40, categoryId: 'entertainment', type: 'expense', date: '2025-11-16' },
  { id:  11, description: 'Uber Eats',          amount:   50, categoryId: 'dining',        type: 'expense', date: '2025-11-10' },
  { id:  12, description: 'Date night',         amount:   75, categoryId: 'dining',        type: 'expense', date: '2025-11-22' },
  { id:  13, description: 'Lyft',               amount:   28, categoryId: 'transport',     type: 'expense', date: '2025-11-18' },
];

// ---------------------------------------------------------------------------
// Monthly budgets (v1 — period always 'monthly')
// ---------------------------------------------------------------------------
//
// These budgets apply to the current month and carry forward each month
// unless the user updates them (FR-04).

export const MOCK_BUDGETS: Budget[] = [
  { categoryId: 'housing',       amount: 1600, period: 'monthly' },
  { categoryId: 'groceries',     amount:  400, period: 'monthly' },
  { categoryId: 'dining',        amount:  200, period: 'monthly' },
  { categoryId: 'transport',     amount:  150, period: 'monthly' },
  { categoryId: 'entertainment', amount:  100, period: 'monthly' },
  { categoryId: 'utilities',     amount:  200, period: 'monthly' },
  { categoryId: 'salary',        amount: 4500, period: 'monthly' },
  { categoryId: 'freelance',     amount:  800, period: 'monthly' },
];
