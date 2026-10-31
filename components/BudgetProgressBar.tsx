import { ExpenseBarColor, IncomeBarColor } from '@/lib/types';

type BarColor = ExpenseBarColor | IncomeBarColor;

// Explicit full class names so Tailwind v4 doesn't purge them
const BAR_COLOR_CLASSES: Record<BarColor, string> = {
  'green':    'bg-data-good',
  'yellow':   'bg-data-caution',
  'orange':   'bg-data-warn',
  'red':      'bg-data-over',
  'deep-red': 'bg-data-over-deep',
};

interface Props {
  percent: number;
  color: BarColor;
  isHidden: boolean;
}

export default function BudgetProgressBar({ percent, color, isHidden }: Props) {
  if (isHidden) {
    return (
      <span data-state="hidden" className="text-xs text-fg-faint italic">Hidden from Budgets</span>
    );
  }

  // Cap the visual fill at 100% — the color already signals the over-budget state
  const fillWidth = Math.min(percent, 100);

  return (
    <div data-testid="budget-progress-bar" className="w-full bg-surface-muted rounded-full h-2">
      <div
        data-state={color}
        className={`${BAR_COLOR_CLASSES[color]} h-2 rounded-full transition-all duration-300`}
        style={{ width: `${fillWidth}%` }}
      />
    </div>
  );
}
