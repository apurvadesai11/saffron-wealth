import type { AccountBucketGroup as AccountBucketGroupType, Account } from "@/lib/types";
import AccountRow from "./AccountRow";

interface Props {
  group: AccountBucketGroupType;
  onEdit: (account: Account) => void;
  onDelete: (account: Account) => void;
}

export default function AccountBucketGroup({ group, onEdit, onDelete }: Props) {
  return (
    <section data-bucket={group.bucket}>
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
          {group.label}
        </h3>
        <span className="text-xs font-medium text-gray-500">
          ${group.bucketTotal.toFixed(2)}
        </span>
      </div>
      <ul className="divide-y divide-gray-50">
        {group.accounts.map((account) => (
          <AccountRow
            key={account.id}
            account={account}
            onEdit={() => onEdit(account)}
            onDelete={() => onDelete(account)}
          />
        ))}
      </ul>
    </section>
  );
}
