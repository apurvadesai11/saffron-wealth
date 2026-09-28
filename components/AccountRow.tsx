"use client";

import { useState } from "react";
import type { Account } from "@/lib/types";
import {
  ACCOUNT_TYPE_LABELS,
  describeAccountBalance,
  getBucketForType,
  isLiability,
} from "@/lib/account-utils";

interface Props {
  account: Account;
  onEdit: () => void;
  // Named for what it does. archiveAccount (lib/accounts.ts) sets archivedAt
  // and never removes the row — the account moves to the archived group with a
  // working Restore. Calling this "delete" described something the app has
  // never done.
  onArchive: () => void;
}

export default function AccountRow({ account, onEdit, onArchive }: Props) {
  // Inline rather than a modal: the action is recoverable, and nesting a
  // dialog inside the page for a reversible archive is heavier than the
  // decision warrants. It still has to be an explicit second action — the
  // control sits next to the row's edit button, which makes a misclick likely
  // rather than theoretical.
  const [confirming, setConfirming] = useState(false);

  const liability = isLiability(getBucketForType(account.type));
  const { text: balanceText, sign: balanceSign } = describeAccountBalance(
    account.type,
    account.balance,
  );
  // A credited card ADDS to net worth, so it reads in the ordinary colour
  // rather than the debt red that would imply money owed.
  const amountClass = balanceSign === "owed" ? "text-red-600" : "text-gray-800";
  // balanceAsOf is a full ISO timestamp; only the date portion is shown.
  const asOfDate = account.balanceAsOf.slice(0, 10);

  return (
    <li
      data-liability={liability ? "true" : "false"}
      data-confirming={confirming ? "true" : undefined}
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
        <span
          data-balance-sign={balanceSign}
          className={`text-sm font-semibold ${amountClass}`}
        >
          {balanceText}
        </span>
        {confirming ? (
          <span className="flex items-center gap-2 text-xs">
            <span className="text-gray-600">Archive?</span>
            <button
              onClick={() => {
                setConfirming(false);
                onArchive();
              }}
              className="min-h-6 min-w-6 px-2 rounded text-red-700 font-medium hover:bg-red-50 transition-colors"
            >
              Yes, archive
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="min-h-6 min-w-6 px-2 rounded text-gray-600 hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
          </span>
        ) : (
          // text-gray-500 is ~4.8:1 on white; the previous text-gray-300 was
          // ~1.5:1, under WCAG 1.4.11's 3:1 floor for a non-text control.
          // min-h-6/min-w-6 is 24x24 CSS px, the SC 2.5.8 target minimum —
          // the bare glyph reserved roughly 10px.
          <button
            onClick={() => setConfirming(true)}
            className="min-h-6 min-w-6 flex items-center justify-center rounded text-xs text-gray-500 hover:text-red-600 hover:bg-gray-100 transition-colors"
            aria-label={`Archive ${account.name}`}
          >
            ✕
          </button>
        )}
      </div>
    </li>
  );
}
