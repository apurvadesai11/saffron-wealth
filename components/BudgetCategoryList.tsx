import { BudgetProgress } from '@/lib/types';
import BudgetCategoryRow from './BudgetCategoryRow';

interface Props {
  label: string;
  items: BudgetProgress[];
  onEdit?: (categoryId: string) => void;
}

export default function BudgetCategoryList({ label, items, onEdit }: Props) {
  if (items.length === 0) return null;

  return (
    <div>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-6 pt-4 pb-0">
        {label}
      </p>
      <ul className="divide-y divide-gray-50 px-6">
        {items.map(item => (
          <BudgetCategoryRow
            key={item.categoryId}
            progress={item}
            onEdit={onEdit ? () => onEdit(item.categoryId) : undefined}
          />
        ))}
      </ul>
    </div>
  );
}
