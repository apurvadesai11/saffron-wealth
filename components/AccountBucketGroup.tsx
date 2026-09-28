import type { AccountBucketGroup as AccountBucketGroupType, Account } from "@/lib/types";
import AccountRow from "./AccountRow";

interface Props {
  group: AccountBucketGroupType;
  onEdit: (account: Account) => void;
  onArchive: (account: Account) => void;
}

export default function AccountBucketGroup({ group, onEdit, onArchive }: Props) {
  // The uncategorized bucket contributes to none of the summary cards above
  // this list (see lib/account-utils.ts's computeNetWorth). Rendered
  // identically to Cash or Debt it read as counted, so the page showed a
  // bucket list that did not add up to the cards and said nothing about why.
  // The import preview explains it once, but only for new accounts and only on
  // the import that created them — this is the standing surface.
  const excluded = group.bucket === "uncategorized";

  return (
    <section
      data-bucket={group.bucket}
      data-excluded-from-net-worth={excluded ? "true" : undefined}
    >
      <div className="flex items-center justify-between mb-1">
        <h3
          className={
            excluded
              ? "text-xs font-semibold text-amber-700 uppercase tracking-wide"
              : "text-xs font-semibold text-gray-400 uppercase tracking-wide"
          }
        >
          {group.label}
        </h3>
        {/* The total is still shown: the number is real, it just isn't in the
            cards, and hiding it would leave the user unable to see the size of
            what they're being asked to classify. */}
        <span
          className={
            excluded
              ? "text-xs font-medium text-amber-700"
              : "text-xs font-medium text-gray-500"
          }
        >
          ${group.bucketTotal.toFixed(2)}
        </span>
      </div>
      {excluded && (
        <p className="text-xs text-amber-700 mb-1">
          Excluded from your net worth until you set a type — open an account to fix it.
        </p>
      )}
      <ul className="divide-y divide-gray-50">
        {group.accounts.map((account) => (
          <AccountRow
            key={account.id}
            account={account}
            onEdit={() => onEdit(account)}
            onArchive={() => onArchive(account)}
          />
        ))}
      </ul>
    </section>
  );
}
