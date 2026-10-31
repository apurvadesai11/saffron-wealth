"use client";

import { useState } from "react";
import type { AccountBucketGroup as AccountBucketGroupType, Account } from "@/lib/types";
import { formatUsd } from "@/lib/money";
import AccountRow from "./AccountRow";

interface Props {
  group: AccountBucketGroupType;
  onEdit: (account: Account) => void;
  onArchive: (account: Account) => void;
  onToggleHidden: (account: Account) => void;
}

export default function AccountBucketGroup({ group, onEdit, onArchive, onToggleHidden }: Props) {
  // The uncategorized bucket contributes to none of the summary cards above
  // this list (see lib/account-utils.ts's computeNetWorth). Rendered
  // identically to Cash or Debt it read as counted, so the page showed a
  // bucket list that did not add up to the cards and said nothing about why.
  // The import preview explains it once, but only for new accounts and only on
  // the import that created them — this is the standing surface.
  const excluded = group.bucket === "uncategorized";
  // Not remembered across reloads: every section opens expanded.
  const [expanded, setExpanded] = useState(true);
  const listId = `bucket-${group.bucket}-accounts`;

  return (
    <section
      data-bucket={group.bucket}
      data-excluded-from-net-worth={excluded ? "true" : undefined}
      data-collapsed={expanded ? undefined : "true"}
    >
      <div className="flex items-center justify-between mb-1">
        <h3>
          <button
            onClick={() => setExpanded((prev) => !prev)}
            aria-expanded={expanded}
            aria-controls={listId}
            className={`flex items-center gap-2 text-base font-semibold hover:opacity-80 transition-opacity ${
              excluded ? "text-warning-strong" : "text-fg"
            }`}
          >
            <span
              aria-hidden="true"
              className={`text-fg-muted text-lg leading-none transition-transform ${
                expanded ? "rotate-90" : ""
              }`}
            >
              ›
            </span>
            {group.label}
          </button>
        </h3>
        {/* The total is still shown: the number is real, it just isn't in the
            cards, and hiding it would leave the user unable to see the size of
            what they're being asked to classify. It stays in view when the
            section is collapsed, since it's the section's summary. */}
        <span
          className={
            excluded
              ? "text-base font-semibold text-warning-strong"
              : "text-base font-semibold text-fg"
          }
        >
          {formatUsd(group.bucketTotal)}
        </span>
      </div>
      {expanded && (
        <>
          {excluded && (
            <p className="text-xs text-warning-strong mb-1">
              Excluded from your net worth until you set a type — open an account to fix it.
            </p>
          )}
          <ul id={listId} className="divide-y divide-line-faint">
            {group.accounts.map((account) => (
              <AccountRow
                key={account.id}
                account={account}
                onEdit={() => onEdit(account)}
                onArchive={() => onArchive(account)}
                onToggleHidden={() => onToggleHidden(account)}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
