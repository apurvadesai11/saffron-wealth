import type { Account } from "@/lib/types";
import { ACCOUNT_TYPE_LABELS } from "@/lib/account-utils";
import { formatUsd } from "@/lib/money";

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
      <summary className="text-xs font-semibold text-fg-faint uppercase tracking-wide cursor-pointer select-none">
        Archived accounts ({accounts.length})
      </summary>
      <ul className="divide-y divide-line-faint mt-2">
        {accounts.map((account) => (
          <li key={account.id} className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm font-medium text-fg-muted">{account.name}</p>
              <p className="text-xs text-fg-faint">
                {ACCOUNT_TYPE_LABELS[account.type]}
                {account.institution ? ` · ${account.institution}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-sm text-fg-faint">{formatUsd(account.balance)}</span>
              <button
                onClick={() => onRestore(account)}
                className="text-xs font-medium text-accent hover:text-accent-strong transition-colors"
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
