"use client";

import { useEffect, useRef, useState } from "react";
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
  const confirmRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // The control the user activated is unmounted and replaced by the confirm.
  // Without moving focus, activating it by keyboard drops focus onto <body>,
  // leaving the confirm they just asked for reachable only by tabbing from the
  // top of the document. `wasConfirming` so cancelling hands focus back to the
  // trigger rather than leaving it nowhere, and so the initial render doesn't
  // steal focus from whatever has it.
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
    else if (wasConfirming.current) triggerRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  const liability = isLiability(getBucketForType(account.type));
  const { text: balanceText, sign: balanceSign } = describeAccountBalance(
    account.type,
    account.balance,
  );
  // A credited card ADDS to net worth, so it reads in the ordinary colour
  // rather than the debt red that would imply money owed.
  const amountClass = balanceSign === "owed" ? "text-danger" : "text-fg-soft";
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
        <p className="text-sm font-medium text-fg-soft">{account.name}</p>
        <p className="text-xs text-fg-faint">
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
          // role="alert" so the confirm is announced; a swap this small is
          // otherwise a silent change for a screen-reader user.
          <span className="flex items-center gap-2 text-xs" role="alert">
            <span className="text-fg-tertiary">Archive?</span>
            <button
              ref={confirmRef}
              onClick={() => {
                setConfirming(false);
                onArchive();
              }}
              className="min-h-6 min-w-6 px-2 rounded text-danger-strong font-medium hover:bg-danger-soft transition-colors"
            >
              Yes, archive
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="min-h-6 min-w-6 px-2 rounded text-fg-tertiary hover:bg-surface-muted transition-colors"
            >
              Cancel
            </button>
          </span>
        ) : (
          // text-fg-muted is ~4.8:1 on surface; the previous text-fg-disabled was
          // ~1.5:1, under WCAG 1.4.11's 3:1 floor for a non-text control.
          // min-h-6/min-w-6 is 24x24 CSS px, the SC 2.5.8 target minimum —
          // the bare glyph reserved roughly 10px.
          <button
            ref={triggerRef}
            onClick={() => setConfirming(true)}
            className="min-h-6 min-w-6 flex items-center justify-center rounded text-xs text-fg-muted hover:text-danger hover:bg-surface-muted transition-colors"
            aria-label={`Archive ${account.name}`}
          >
            ✕
          </button>
        )}
      </div>
    </li>
  );
}
