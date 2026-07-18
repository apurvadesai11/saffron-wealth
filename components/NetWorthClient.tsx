"use client";

import { useState } from "react";
import type { Account, AccountInput } from "@/lib/types";
import { computeNetWorth, groupAccountsByBucket } from "@/lib/account-utils";
import { readCsrfCookie } from "@/lib/auth/csrf-client";
import { CSRF_HEADER_NAME } from "@/lib/auth/csrf-shared";
import NetWorthSummaryCards from "./NetWorthSummaryCards";
import AccountBucketGroup from "./AccountBucketGroup";
import AccountEditModal from "./AccountEditModal";

interface Props {
  initialAccounts: Account[];
}

export default function NetWorthClient({ initialAccounts }: Props) {
  const [accounts, setAccounts] = useState<Account[]>(initialAccounts);
  const [editingAccount, setEditingAccount] = useState<Account | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const summary = computeNetWorth(accounts);
  const groups = groupAccountsByBucket(accounts);

  async function handleSave(input: AccountInput) {
    setError(null);
    const csrf = readCsrfCookie() ?? "";
    const isEditing = editingAccount !== null && editingAccount !== "new";

    try {
      const res = await fetch(
        isEditing ? `/api/accounts/${(editingAccount as Account).id}` : "/api/accounts",
        {
          method: isEditing ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
            [CSRF_HEADER_NAME]: csrf,
          },
          body: JSON.stringify(input),
        },
      );
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data?.error?.message ?? "Save failed.");
        return;
      }
      const saved = data.data.account as Account;
      setAccounts((prev) =>
        isEditing ? prev.map((a) => (a.id === saved.id ? saved : a)) : [...prev, saved],
      );
      setEditingAccount(null);
    } catch {
      setError("Network error.");
    }
  }

  async function handleDelete(account: Account) {
    setError(null);
    const csrf = readCsrfCookie() ?? "";
    try {
      const res = await fetch(`/api/accounts/${account.id}`, {
        method: "DELETE",
        headers: { [CSRF_HEADER_NAME]: csrf },
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data?.error?.message ?? "Delete failed.");
        return;
      }
      setAccounts((prev) => prev.filter((a) => a.id !== account.id));
    } catch {
      setError("Network error.");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Net Worth</h1>
          <p className="text-sm text-gray-500 mt-1">
            Track your accounts, properties, and debts in one place.
          </p>
        </div>
        <button
          onClick={() => setEditingAccount("new")}
          className="bg-blue-600 text-white rounded-lg py-2 px-4 text-sm font-medium hover:bg-blue-700 transition-colors shrink-0"
        >
          + Add Account
        </button>
      </div>

      <NetWorthSummaryCards summary={summary} />

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-2">
          {error}
        </p>
      )}

      <div className="bg-white rounded-2xl shadow-sm p-6 space-y-6">
        {groups.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-8">
            No accounts yet. Add your first account to start tracking your net worth.
          </p>
        ) : (
          groups.map((group) => (
            <AccountBucketGroup
              key={group.bucket}
              group={group}
              onEdit={(account) => setEditingAccount(account)}
              onDelete={handleDelete}
            />
          ))
        )}
      </div>

      {editingAccount !== null && (
        <AccountEditModal
          account={editingAccount === "new" ? undefined : editingAccount}
          onSave={handleSave}
          onClose={() => setEditingAccount(null)}
        />
      )}
    </div>
  );
}
