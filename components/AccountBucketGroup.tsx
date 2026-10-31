"use client";

import { useState } from "react";
import type { AccountBucketGroup as AccountBucketGroupType, Account } from "@/lib/types";
import { formatUsd } from "@/lib/money";
import { moveAccount } from "@/lib/account-utils";
import AccountRow, { type AccountRowDrag } from "./AccountRow";

interface Props {
  group: AccountBucketGroupType;
  onEdit: (account: Account) => void;
  onArchive: (account: Account) => void;
  onToggleHidden: (account: Account) => void;
  // This section's account ids in their new order, after a drop.
  onReorder: (orderedIds: string[]) => void;
}

export default function AccountBucketGroup({
  group,
  onEdit,
  onArchive,
  onToggleHidden,
  onReorder,
}: Props) {
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

  // Drag state lives per section, which is what confines a drag to it: a row
  // dragged from another section leaves draggedId null here, so the drop is
  // never accepted. Moving an account between sections would mean changing
  // its type, which the edit dialog does.
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const ids = group.accounts.map((a) => a.id);

  function endDrag() {
    setDraggedId(null);
    setOverId(null);
  }

  function dragFor(account: Account): AccountRowDrag | undefined {
    if (group.accounts.length < 2) return undefined;
    return {
      state:
        draggedId === account.id ? "dragging" : draggedId !== null && overId === account.id ? "over" : null,
      handle: {
        onDragStart: (e) => {
          setDraggedId(account.id);
          // Firefox won't start a drag without data; the id is read back from
          // state, not from here.
          e.dataTransfer?.setData("text/plain", account.id);
          if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
          // Drag the whole row's image, not just the grip's.
          const row = e.currentTarget.closest("li");
          if (row) e.dataTransfer?.setDragImage?.(row, 0, 0);
        },
        onDragEnd: endDrag,
      },
      target: {
        onDragOver: (e) => {
          if (draggedId === null) return;
          e.preventDefault();
          if (overId !== account.id) setOverId(account.id);
        },
        onDrop: (e) => {
          if (draggedId === null) return;
          e.preventDefault();
          const next = moveAccount(ids, draggedId, account.id);
          if (next !== ids) onReorder(next);
          endDrag();
        },
      },
    };
  }

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
                drag={dragFor(account)}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
