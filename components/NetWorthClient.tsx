"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Account, AccountInput } from "@/lib/types";
import type { NetWorthPoint } from "@/lib/net-worth-history";
import { computeNetWorth, groupAccountsByBucket } from "@/lib/account-utils";
import { readCsrfCookie } from "@/lib/auth/csrf-client";
import { CSRF_HEADER_NAME } from "@/lib/auth/csrf-shared";
import NetWorthChart from "./NetWorthChart";
import NetWorthSummaryCards from "./NetWorthSummaryCards";
import AccountBucketGroup from "./AccountBucketGroup";
import ArchivedAccountsGroup from "./ArchivedAccountsGroup";
import AccountEditModal from "./AccountEditModal";
import BalanceHistoryImportModal from "./BalanceHistoryImportModal";

interface Props {
  initialAccounts: Account[];
  initialArchivedAccounts: Account[];
  series: NetWorthPoint[];
}

export default function NetWorthClient({ initialAccounts, initialArchivedAccounts, series }: Props) {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>(initialAccounts);
  const [archivedAccounts, setArchivedAccounts] = useState<Account[]>(initialArchivedAccounts);
  const [editingAccount, setEditingAccount] = useState<Account | "new" | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A committed balance-history import can create, update, and archive many
  // accounts in one request, with no per-row response shape to merge in the
  // way handleSave/handleDelete/handleRestore below do for a single account
  // — and the chart's `series` prop specifically must never be recomputed
  // from a raw event log on the client (that derivation is server-only; see
  // app/(app)/net-worth/page.tsx). router.refresh() re-runs that page and
  // hands this component fresh initialAccounts/initialArchivedAccounts/
  // series props; syncing local state from them here is a plain prop-sync
  // effect, NOT lib/app-context.tsx's seed-sync/beginRefresh machinery —
  // this page has no AppProvider and no second component mutating this same
  // state concurrently, so there's no cross-component race for that
  // machinery to guard against. `series` itself needs no such effect: it's
  // read straight from props into NetWorthChart below with no local state,
  // so a fresh prop value after refresh renders immediately.
  useEffect(() => {
    setAccounts(initialAccounts);
  }, [initialAccounts]);
  useEffect(() => {
    setArchivedAccounts(initialArchivedAccounts);
  }, [initialArchivedAccounts]);

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
      // Delete is a soft-archive (archiveAccount sets archivedAt, it never
      // removes the row) — reflect that immediately by moving the account
      // into the Archived group rather than just dropping it, so Restore is
      // available without a page reload.
      setAccounts((prev) => prev.filter((a) => a.id !== account.id));
      setArchivedAccounts((prev) => [account, ...prev]);
    } catch {
      setError("Network error.");
    }
  }

  async function handleRestore(account: Account) {
    setError(null);
    const csrf = readCsrfCookie() ?? "";
    try {
      const res = await fetch(`/api/accounts/${account.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          [CSRF_HEADER_NAME]: csrf,
        },
        body: JSON.stringify({ archivedAt: null }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data?.error?.message ?? "Restore failed.");
        return;
      }
      const restored = data.data.account as Account;
      setArchivedAccounts((prev) => prev.filter((a) => a.id !== account.id));
      setAccounts((prev) => [...prev, restored]);
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
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => setShowImportModal(true)}
            className="border border-gray-200 text-gray-700 rounded-lg py-2 px-4 text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Import balance history
          </button>
          <button
            onClick={() => setEditingAccount("new")}
            className="bg-blue-600 text-white rounded-lg py-2 px-4 text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            + Add Account
          </button>
        </div>
      </div>

      <NetWorthChart series={series} />

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

      {archivedAccounts.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <ArchivedAccountsGroup accounts={archivedAccounts} onRestore={handleRestore} />
        </div>
      )}

      {editingAccount !== null && (
        <AccountEditModal
          account={editingAccount === "new" ? undefined : editingAccount}
          onSave={handleSave}
          onClose={() => setEditingAccount(null)}
        />
      )}

      {showImportModal && (
        <BalanceHistoryImportModal
          onClose={() => setShowImportModal(false)}
          onImported={() => router.refresh()}
        />
      )}
    </div>
  );
}
