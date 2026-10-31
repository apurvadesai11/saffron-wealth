"use client";

import { useEffect, useRef } from "react";
import type { Transaction } from "@/lib/types";
import { useFocusTrap } from "@/lib/use-focus-trap";
import TransactionForm from "./TransactionForm";

interface Props {
  transaction: Transaction;
  onClose: () => void;
}

// A dialog rather than the inline slot the add form uses: the row being
// edited can be far down a long list, and opening the form at the top of the
// card would scroll the user away from it.
export default function TransactionEditModal({ transaction, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  // Confines Tab to this dialog and restores focus to whatever opened it.
  useFocusTrap(dialogRef);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40 px-4 py-6"
      onClick={onClose}
      aria-label="Close modal"
    >
      <div
        ref={dialogRef}
        className="bg-surface rounded-2xl shadow-xl w-full max-w-lg max-h-full flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transaction-edit-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-4 border-b border-line-subtle shrink-0">
          <div className="flex items-start justify-between">
            <h2 id="transaction-edit-title" className="text-xl font-bold text-fg">
              Edit Transaction
            </h2>
            <button
              onClick={onClose}
              className="text-fg-disabled hover:text-fg-muted transition-colors text-2xl leading-none mt-0.5"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        <div className="px-6 py-5 overflow-y-auto min-h-0">
          <TransactionForm transaction={transaction} onSubmitted={onClose} />
        </div>
      </div>
    </div>
  );
}
