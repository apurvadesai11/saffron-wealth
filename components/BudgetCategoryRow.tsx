import { BudgetProgress } from '@/lib/types';
import BudgetProgressBar from './BudgetProgressBar';

interface Props {
  progress: BudgetProgress;
  onEdit?: () => void;
}

export default function BudgetCategoryRow({ progress, onEdit }: Props) {
  const {
    categoryName,
    categoryType,
    budgetAmount,
    spent,
    percent,
    barColor,
    isHidden,
  } = progress;

  const isExpense = categoryType === 'expense';
  const delta = budgetAmount - spent;

  const spentLabel    = isExpense ? 'Spent'    : 'Received';
  const remainLabel   = isExpense ? 'left'     : 'remaining';
  const overLabel     = isExpense ? 'over budget' : 'surplus';
  const percentSuffix = isExpense ? '% used'   : '% received';

  const amountColor =
    isExpense && (barColor === 'red' || barColor === 'deep-red')
      ? 'text-red-600'
      : 'text-gray-800';

  const inner = (
    <>
      {/* Row header: name + amounts + edit chevron */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-800">{categoryName}</span>
        <div className="flex items-center gap-2">
          {!isHidden && (
            <span className="text-sm">
              <span className={`font-semibold ${amountColor}`}>
                ${spent.toFixed(0)}
              </span>
              <span className="text-gray-400"> / ${budgetAmount.toFixed(0)}</span>
            </span>
          )}
          {onEdit && (
            <span className="text-gray-300 text-base leading-none">›</span>
          )}
        </div>
      </div>

      {/* Progress bar or hidden label */}
      <BudgetProgressBar percent={percent} color={barColor} isHidden={isHidden} />

      {/* Sub-row: percent + remaining / over */}
      {!isHidden && (
        <div className="flex justify-between mt-1.5">
          <span className="text-xs text-gray-400">
            {percent.toFixed(0)}{percentSuffix}
          </span>
          <span
            className={`text-xs font-medium ${
              delta < 0 ? 'text-red-500' : 'text-gray-400'
            }`}
          >
            {delta < 0
              ? `$${Math.abs(delta).toFixed(0)} ${overLabel}`
              : `$${delta.toFixed(0)} ${remainLabel}`
            }
          </span>
        </div>
      )}
    </>
  );

  if (onEdit) {
    return (
      <li>
        <button
          onClick={onEdit}
          className="w-full text-left py-4 hover:bg-gray-50 transition-colors rounded-lg px-1 -mx-1"
        >
          {inner}
        </button>
      </li>
    );
  }

  return <li className="py-4">{inner}</li>;
}
