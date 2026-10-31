"use client";

import { useEffect, useRef, useState } from "react";
import type { Account, AccountInput, AccountType } from "@/lib/types";
import { useFocusTrap } from "@/lib/use-focus-trap";
import {
  BUCKET_ORDER,
  ACCOUNT_TYPES_BY_BUCKET,
  ACCOUNT_BUCKET_LABELS,
  ACCOUNT_TYPE_LABELS,
} from "@/lib/account-utils";

const DEFAULT_TYPE: AccountType = "cash";

interface Props {
  account?: Account;
  onSave: (input: AccountInput) => void;
  onClose: () => void;
}

export default function AccountEditModal({ account, onSave, onClose }: Props) {
  const isEditing = account !== undefined;
  const [name, setName] = useState(account?.name ?? "");
  const [type, setType] = useState<AccountType>(account?.type ?? DEFAULT_TYPE);
  const [institution, setInstitution] = useState(account?.institution ?? "");
  const [balance, setBalance] = useState(account ? String(account.balance) : "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const nameInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // Confines Tab to this dialog and restores focus to whatever opened it.
  useFocusTrap(dialogRef);

  // 'uncategorized' is what the import assigns when it recognizes nothing, and
  // it contributes to no net-worth total. That makes it a state to move OUT of,
  // not a type a person picks — so it is offered only when this account already
  // carries it, which is what lets the select show the real current value and
  // lets the user correct it.
  const bucketsForSelect = BUCKET_ORDER.filter(
    (bucket) => bucket !== "uncategorized" || account?.type === "uncategorized",
  );

  // Autofocus name field when the modal opens.
  useEffect(() => {
    nameInputRef.current?.focus();
    nameInputRef.current?.select();
  }, []);

  // Close on Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleSave() {
    const trimmedName = name.trim();
    const parsedBalance = parseFloat(balance.trim());
    const fieldErrors: Record<string, string> = {};

    if (trimmedName === "") fieldErrors.name = "Account name is required.";
    // Negative is valid: an asset can be overdrawn and a debt balance (the
    // amount owed) goes negative when the account carries a statement
    // credit. The import can produce both, so refusing them here would show
    // the user a value the editor won't let them type back.
    if (balance.trim() === "" || isNaN(parsedBalance)) {
      fieldErrors.balance = "Enter a valid amount.";
    }

    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }

    onSave({
      name: trimmedName,
      type,
      institution: institution.trim() === "" ? null : institution.trim(),
      balance: parsedBalance,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40 px-4"
      onClick={onClose}
      aria-label="Close modal"
    >
      <div
        ref={dialogRef}
        className="bg-surface rounded-2xl shadow-xl w-full max-w-md"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-4 border-b border-line-subtle">
          <div className="flex items-start justify-between">
            <h2 id="account-modal-title" className="text-xl font-bold text-fg">
              {isEditing ? "Edit Account" : "Add Account"}
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

        <div className="px-6 py-5 space-y-4">
          <div>
            <label htmlFor="account-name" className="block text-sm font-medium text-fg-secondary mb-1">
              Account name
            </label>
            <input
              ref={nameInputRef}
              id="account-name"
              type="text"
              placeholder="e.g. Fidelity Brokerage"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setErrors((prev) => ({ ...prev, name: "" }));
              }}
              className="w-full border border-line rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-accent-ring"
            />
            {errors.name && <p className="text-xs text-danger-muted mt-1.5">{errors.name}</p>}
          </div>

          <div>
            <label htmlFor="account-type" className="block text-sm font-medium text-fg-secondary mb-1">
              Type
            </label>
            <select
              id="account-type"
              value={type}
              onChange={(e) => setType(e.target.value as AccountType)}
              className="w-full border border-line rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-accent-ring"
            >
              {bucketsForSelect.map((bucket) => (
                <optgroup key={bucket} label={ACCOUNT_BUCKET_LABELS[bucket]}>
                  {ACCOUNT_TYPES_BY_BUCKET[bucket].map((t) => (
                    <option key={t} value={t}>
                      {ACCOUNT_TYPE_LABELS[t]}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="account-institution" className="block text-sm font-medium text-fg-secondary mb-1">
              Institution <span className="text-fg-faint font-normal">(optional)</span>
            </label>
            <input
              id="account-institution"
              type="text"
              placeholder="e.g. Vanguard"
              value={institution}
              onChange={(e) => setInstitution(e.target.value)}
              className="w-full border border-line rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-accent-ring"
            />
          </div>

          <div>
            <label htmlFor="account-balance" className="block text-sm font-medium text-fg-secondary mb-1">
              Balance
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted font-medium">
                $
              </span>
              <input
                id="account-balance"
                type="number"
                step="0.01"
                placeholder="0.00"
                value={balance}
                onChange={(e) => {
                  setBalance(e.target.value);
                  setErrors((prev) => ({ ...prev, balance: "" }));
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSave();
                }}
                className="w-full border border-line rounded-lg pl-7 pr-4 py-2.5 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-accent-ring"
              />
            </div>
            {errors.balance && <p className="text-xs text-danger-muted mt-1.5">{errors.balance}</p>}
          </div>
        </div>

        <div className="px-6 pb-6 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 border border-line text-fg-secondary rounded-lg py-2.5 text-sm font-medium hover:bg-surface-sunken transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex-1 bg-accent-solid text-on-solid rounded-lg py-2.5 text-sm font-medium hover:bg-accent-solid-hover transition-colors"
          >
            {isEditing ? "Save Changes" : "Add Account"}
          </button>
        </div>
      </div>
    </div>
  );
}
