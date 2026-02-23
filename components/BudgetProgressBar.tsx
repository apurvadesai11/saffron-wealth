import { ExpenseBarColor, IncomeBarColor } from '@/lib/types';

type BarColor = ExpenseBarColor | IncomeBarColor;

// Explicit full class names so Tailwind v4 doesn't purge them
const BAR_COLOR_CLASSES: Record<BarColor, string> = {
  'green':    'bg-green-500',
  'yellow':   'bg-yellow-400',
  'orange':   'bg-orange-400',
  'red':      'bg-red-500',
  'deep-red': 'bg-red-700',
};

interface Props {
  percent: number;
  color: BarColor;
  isHidden: boolean;
}

export default function BudgetProgressBar({ percent, color, isHidden }: Props) {
  if (isHidden) {
    return (
      <span className="text-xs text-gray-400 italic">Hidden from Budgets</span>
    );
  }

  // Cap the visual fill at 100% — the color already signals the over-budget state
  const fillWidth = Math.min(percent, 100);

  return (
    <div className="w-full bg-gray-100 rounded-full h-2">
      <div
        className={`${BAR_COLOR_CLASSES[color]} h-2 rounded-full transition-all duration-300`}
        style={{ width: `${fillWidth}%` }}
      />
    </div>
  );
}
