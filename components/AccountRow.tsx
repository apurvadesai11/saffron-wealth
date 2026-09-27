import type { Account } from "@/lib/types";
import { ACCOUNT_TYPE_LABELS, getBucketForType, isLiability } from "@/lib/account-utils";

interface Props {
  account: Account;
  onEdit: () => void;
  onDelete: () => void;
}

export default function AccountRow({ account, onEdit, onDelete }: Props) {
  const liability = isLiability(getBucketForType(account.type));
  // balanceAsOf is a full ISO timestamp; only the date portion is shown.
  const asOfDate = account.balanceAsOf.slice(0, 10);

  return (
    <li
      data-liability={liability ? "true" : "false"}
      className="flex items-center justify-between py-4"
    >
      <button
        onClick={onEdit}
        className="flex-1 text-left hover:opacity-80 transition-opacity"
      >
        <p className="text-sm font-medium text-gray-800">{account.name}</p>
        <p className="text-xs text-gray-400">
          {ACCOUNT_TYPE_LABELS[account.type]}
          {account.institution ? ` · ${account.institution}` : ""}
          {` · as of ${asOfDate}`}
        </p>
      </button>
      <div className="flex items-center gap-3 shrink-0">
        <span className={`text-sm font-semibold ${liability ? "text-red-600" : "text-gray-800"}`}>
          ${account.balance.toFixed(2)}
        </span>
        <button
          onClick={onDelete}
          className="text-gray-300 hover:text-red-400 transition-colors text-xs"
          aria-label={`Delete ${account.name}`}
        >
          ✕
        </button>
      </div>
    </li>
  );
}
