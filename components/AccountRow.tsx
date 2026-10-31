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
  // Flips hiddenFromNetWorth. The row only reports the click; NetWorthClient
  // owns the PATCH and the totals.
  onToggleHidden: () => void;
  // Present when the row can be dragged within its section. The section owns
  // the drag; the row only renders the handle and wires its own events.
  drag?: AccountRowDrag;
}

export interface AccountRowDrag {
  state: "dragging" | "over" | null;
  handle: Pick<React.HTMLAttributes<HTMLSpanElement>, "onDragStart" | "onDragEnd">;
  target: Pick<React.HTMLAttributes<HTMLLIElement>, "onDragOver" | "onDrop">;
}

// A six-dot grip, drawn like the other icons in this file.
function GripIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="9" cy="6" r="1.5" />
      <circle cx="15" cy="6" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="18" r="1.5" />
      <circle cx="15" cy="18" r="1.5" />
    </svg>
  );
}

// Feather's "eye-off" glyph, drawn like the sidebar icons in lib/nav-config.ts.
function ClosedEyeIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-3.5 w-3.5 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="Hidden from net worth"
    >
      <title>Hidden from net worth</title>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

export default function AccountRow({ account, onEdit, onArchive, onToggleHidden, drag }: Props) {
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
  // rather than the debt red that would imply money owed. A hidden balance is
  // real but uncounted, so it's muted instead.
  const hidden = account.hiddenFromNetWorth;
  const amountClass = hidden
    ? "text-fg-faint"
    : balanceSign === "owed"
      ? "text-danger"
      : "text-fg-soft";
  // balanceAsOf is a full ISO timestamp; only the date portion is shown.
  const asOfDate = account.balanceAsOf.slice(0, 10);

  return (
    <li
      data-liability={liability ? "true" : "false"}
      data-confirming={confirming ? "true" : undefined}
      data-hidden-from-net-worth={hidden ? "true" : undefined}
      data-drag-state={drag?.state ?? undefined}
      {...drag?.target}
      className={`flex items-center justify-between py-4 transition-colors ${
        drag?.state === "over" ? "bg-accent-soft" : ""
      } ${drag?.state === "dragging" ? "opacity-50" : ""}`}
    >
      {/* Only the grip starts a drag, so a click on the row still edits it. */}
      {drag && (
        <span
          draggable
          {...drag.handle}
          aria-label={`Drag to reorder ${account.name}`}
          title="Drag to reorder"
          className="mr-2 shrink-0 cursor-grab active:cursor-grabbing text-fg-faint hover:text-fg-muted"
        >
          <GripIcon />
        </span>
      )}
      <button
        onClick={onEdit}
        className="flex-1 text-left hover:opacity-80 transition-opacity"
      >
        <p className="flex items-center gap-1.5 text-sm font-medium text-fg-soft">
          {account.name}
          {hidden && (
            <span className="text-fg-muted">
              <ClosedEyeIcon />
            </span>
          )}
        </p>
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
          <>
            <button
              onClick={onToggleHidden}
              className="min-h-6 px-2 rounded text-xs font-medium text-fg-muted hover:text-fg hover:bg-surface-muted transition-colors"
              aria-label={
                hidden
                  ? `Show ${account.name} in Net Worth`
                  : `Hide ${account.name} from Net Worth`
              }
            >
              {hidden ? "Show in Net Worth" : "Hide from Net Worth"}
            </button>
            {/* A word rather than the old ✕, which read as delete. The confirm
                step stays: it still sits beside the row's edit target.
                text-fg-muted is ~4.8:1 on surface, clear of WCAG 1.4.11's 3:1;
                min-h-6/min-w-6 is SC 2.5.8's 24x24 CSS px. */}
            <button
              ref={triggerRef}
              onClick={() => setConfirming(true)}
              className="min-h-6 min-w-6 px-2 flex items-center justify-center rounded text-xs font-medium text-fg-muted hover:text-danger hover:bg-surface-muted transition-colors"
              aria-label={`Archive ${account.name}`}
            >
              Archive
            </button>
          </>
        )}
      </div>
    </li>
  );
}
