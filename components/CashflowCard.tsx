import { Budget, Category, Transaction } from '@/lib/types';
import {
  getCashflowProjection,
  getCurrentPeriodSpend,
  getDaysElapsedInPeriod,
} from '@/lib/budget-utils';

interface Props {
  transactions: Transaction[];
  budgets: Budget[];
  categories: Category[];
  asOf: Date;
}

export default function CashflowCard({ transactions, budgets, categories, asOf }: Props) {
  const projection   = getCashflowProjection(transactions, budgets, categories, asOf);
  const daysElapsed  = getDaysElapsedInPeriod(asOf, 'monthly');

  // Month-to-date actuals: sum all transactions recorded this period
  const totalReceived = categories
    .filter(c => c.type === 'income')
    .reduce((sum, c) => sum + getCurrentPeriodSpend(transactions, c.id, 'monthly', asOf), 0);

  const totalSpent = categories
    .filter(c => c.type === 'expense')
    .reduce((sum, c) => sum + getCurrentPeriodSpend(transactions, c.id, 'monthly', asOf), 0);

  const mtdNet        = totalReceived - totalSpent;
  const netPositive   = projection.projectedNet >= 0;
  const mtdPositive   = mtdNet >= 0;
  const hasMtdData    = totalReceived > 0 || totalSpent > 0;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">
        Cashflow Forecast
      </p>

      {/* ── Row 1: planned totals + projected net ─────────────────────── */}
      <div className="grid grid-cols-3 gap-4">
        <div>
          <p className="text-xs text-gray-500 mb-1">Budgeted Income</p>
          <p className="text-xl font-bold text-green-600">
            ${projection.budgetedIncome.toLocaleString()}
          </p>
        </div>

        <div>
          <p className="text-xs text-gray-500 mb-1">Budgeted Expenses</p>
          <p className="text-xl font-bold text-gray-800">
            ${projection.budgetedExpenses.toLocaleString()}
          </p>
        </div>

        <div>
          <p className="text-xs text-gray-500 mb-1">Projected Net</p>
          <p className={`text-xl font-bold ${netPositive ? 'text-blue-600' : 'text-red-600'}`}>
            {netPositive ? '+' : ''}${Math.round(projection.projectedNet).toLocaleString()}
          </p>
          {/* Sub-label communicates whether this is a live projection or just the plan */}
          <p className="text-xs text-gray-400 mt-0.5">
            {projection.isStaticProjection
              ? 'budget plan'
              : netPositive ? 'projected surplus' : 'projected deficit'
            }
          </p>
        </div>
      </div>

      {/* ── Divider ───────────────────────────────────────────────────── */}
      <div className="border-t border-gray-100 my-4" />

      {/* ── Row 2: month-to-date actuals ──────────────────────────────── */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
          Month to Date
        </p>

        {hasMtdData ? (
          <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-sm">
            <span className="text-gray-600">
              Received{' '}
              <span className="font-semibold text-green-600">
                ${totalReceived.toLocaleString()}
              </span>
            </span>
            <span className="text-gray-200 select-none">·</span>
            <span className="text-gray-600">
              Spent{' '}
              <span className="font-semibold text-gray-800">
                ${totalSpent.toLocaleString()}
              </span>
            </span>
            <span className="text-gray-200 select-none">·</span>
            <span className="text-gray-600">
              Net{' '}
              <span className={`font-semibold ${mtdPositive ? 'text-blue-600' : 'text-red-600'}`}>
                {mtdPositive ? '+' : ''}${mtdNet.toLocaleString()}
              </span>
            </span>
          </div>
        ) : (
          <p className="text-sm text-gray-400 italic">No transactions recorded yet.</p>
        )}
      </div>

      {/* ── Projection context note ───────────────────────────────────── */}
      <p className="text-xs text-gray-400 mt-3">
        {projection.isStaticProjection
          ? 'Showing budget plan — no spending data to project from yet.'
          : `Projecting from ${daysElapsed} day${daysElapsed === 1 ? '' : 's'} of spending data.`
        }
      </p>
    </div>
  );
}
