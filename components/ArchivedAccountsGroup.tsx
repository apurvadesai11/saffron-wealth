import type { Account } from "@/lib/types";
import { ACCOUNT_TYPE_LABELS } from "@/lib/account-utils";

interface Props {
  accounts: Account[];
  onRestore: (account: Account) => void;
}

// Collapsed-by-default group for archived accounts. These are excluded from
// net worth already — computeNetWorth only reads what listAccounts returns,
// and that filters archivedAt: null — so nothing here re-implements the
// exclusion. This exists purely as the Restore escape hatch that the import's
// monotone archiving requires: an account archived by inference rather than by
// a real user delete would otherwise have no way back into net worth. See
// docs/decisions/0003-account-contribution-window.md. Renders nothing when there are
// no archived accounts, mirroring how AccountBucketGroup omits empty buckets.
export default function ArchivedAccountsGroup({ accounts, onRestore }: Props) {
  if (accounts.length === 0) return null;

  return (
    <details data-state="archived-group">
      <summary className="text-xs font-semibold text-gray-400 uppercase tracking-wide cursor-pointer select-none">
        Archived ({accounts.length})
      </summary>
      <ul className="divide-y divide-gray-50 mt-2">
        {accounts.map((account) => (
          <li key={account.id} className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm font-medium text-gray-500">{account.name}</p>
              <p className="text-xs text-gray-400">
                {ACCOUNT_TYPE_LABELS[account.type]}
                {account.institution ? ` · ${account.institution}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-sm text-gray-400">${account.balance.toFixed(2)}</span>
              <button
                onClick={() => onRestore(account)}
                className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors"
              >
                Restore
              </button>
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}
