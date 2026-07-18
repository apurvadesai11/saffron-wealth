"use client";

import { useEffect, useRef, useState } from "react";
import type { Account, AccountInput, AccountType } from "@/lib/types";
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
    if (balance.trim() === "" || isNaN(parsedBalance) || parsedBalance < 0) {
      fieldErrors.balance = "Enter a valid amount ($0 or more).";
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
      aria-label="Close modal"
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-4 border-b border-gray-100">
          <div className="flex items-start justify-between">
            <h2 id="account-modal-title" className="text-xl font-bold text-gray-900">
              {isEditing ? "Edit Account" : "Add Account"}
            </h2>
            <button
              onClick={onClose}
              className="text-gray-300 hover:text-gray-500 transition-colors text-2xl leading-none mt-0.5"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label htmlFor="account-name" className="block text-sm font-medium text-gray-700 mb-1">
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
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {errors.name && <p className="text-xs text-red-500 mt-1.5">{errors.name}</p>}
          </div>

          <div>
            <label htmlFor="account-type" className="block text-sm font-medium text-gray-700 mb-1">
              Type
            </label>
            <select
              id="account-type"
              value={type}
              onChange={(e) => setType(e.target.value as AccountType)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {BUCKET_ORDER.map((bucket) => (
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
            <label htmlFor="account-institution" className="block text-sm font-medium text-gray-700 mb-1">
              Institution <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              id="account-institution"
              type="text"
              placeholder="e.g. Vanguard"
              value={institution}
              onChange={(e) => setInstitution(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label htmlFor="account-balance" className="block text-sm font-medium text-gray-700 mb-1">
              Balance
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium">
                $
              </span>
              <input
                id="account-balance"
                type="number"
                min="0"
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
                className="w-full border border-gray-200 rounded-lg pl-7 pr-4 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {errors.balance && <p className="text-xs text-red-500 mt-1.5">{errors.balance}</p>}
          </div>
        </div>

        <div className="px-6 pb-6 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 border border-gray-200 text-gray-700 rounded-lg py-2.5 text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex-1 bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            {isEditing ? "Save Changes" : "Add Account"}
          </button>
        </div>
      </div>
    </div>
  );
}
