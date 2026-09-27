"use client";

import { useEffect, useRef, useState } from "react";
// Type-only import — erased at compile time, so this pulls in none of
// lib/balance-history-import.ts's Prisma-adjacent value imports at runtime.
// Mirrors MonarchImportModal.tsx's identical use of ImportSummary.
import type { BalanceHistoryImportSummary } from "@/lib/balance-history-import";
import { ACCOUNT_TYPE_LABELS } from "@/lib/account-utils";
import { readCsrfCookie } from "@/lib/auth/csrf-client";
import { CSRF_HEADER_NAME } from "@/lib/auth/csrf-shared";

interface ImportResult {
  eventsInserted: number;
}

type Step = "pick" | "loading" | "preview" | "success";

interface Props {
  onClose: () => void;
  // Fires the instant a commit succeeds (not deferred to "Done") — mirrors
  // MonarchImportModal's beginRefresh()+router.refresh() timing. Unlike that
  // modal, this page has no AppProvider seed-sync to lean on: NetWorthClient
  // owns its own state directly, so the parent just re-fetches via
  // router.refresh() (see NetWorthClient's comment on why that's the right
  // tool here, not a shortcut).
  onImported: () => void;
}

export default function BalanceHistoryImportModal({ onClose, onImported }: Props) {
  const [step, setStep] = useState<Step>("pick");
  const [file, setFile] = useState<File | null>(null);
  const [summary, setSummary] = useState<BalanceHistoryImportSummary | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Autofocus the file input when the modal opens.
  useEffect(() => {
    fileInputRef.current?.focus();
  }, []);

  // Close on Escape, except mid-request — see MonarchImportModal's identical
  // guard: a request that outlives an unmounted modal would try to setState
  // on it, and loading only ever runs while this component is mounted.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && step !== "loading") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, step]);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const picked = input.files?.[0];
    // Clear immediately so re-picking the same path after an error still
    // fires onChange (browsers don't fire "change" for a no-op reselect).
    input.value = "";
    if (!picked) return;

    setError(null);
    setFile(picked);
    setStep("loading");

    const csrf = readCsrfCookie() ?? "";
    const body = new FormData();
    body.set("mode", "preview");
    body.set("file", picked);

    try {
      const res = await fetch("/api/accounts/balance-history", {
        method: "POST",
        headers: { [CSRF_HEADER_NAME]: csrf },
        body,
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data?.error?.message ?? "Import failed.");
        setFile(null);
        setStep("pick");
        return;
      }
      setSummary(data.summary);
      setStep("preview");
    } catch {
      setError("Network error.");
      setFile(null);
      setStep("pick");
    }
  }

  async function handleConfirm() {
    if (!file) return;
    setError(null);
    setStep("loading");

    const csrf = readCsrfCookie() ?? "";
    const body = new FormData();
    body.set("mode", "commit");
    body.set("file", file);

    try {
      const res = await fetch("/api/accounts/balance-history", {
        method: "POST",
        headers: { [CSRF_HEADER_NAME]: csrf },
        body,
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data?.error?.message ?? "Import failed.");
        setStep("preview");
        return;
      }
      setResult({ eventsInserted: data.eventsInserted as number });
      setStep("success");
      onImported();
    } catch {
      setError("Network error.");
      setStep("preview");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={step === "loading" ? undefined : onClose}
      aria-label="Close modal"
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="balance-history-import-title"
        data-import-step={step}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-4 border-b border-gray-100">
          <div className="flex items-start justify-between">
            <h2 id="balance-history-import-title" className="text-xl font-bold text-gray-900">
              Import Balance History
            </h2>
            {step !== "loading" && (
              <button
                onClick={onClose}
                className="text-gray-300 hover:text-gray-500 transition-colors text-2xl leading-none mt-0.5"
                aria-label="Close"
              >
                ×
              </button>
            )}
          </div>
        </div>

        <div className="px-6 py-5 space-y-4">
          {error && (
            <p
              role="alert"
              className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-2"
            >
              {error}
            </p>
          )}

          {step === "pick" && (
            <div>
              <label
                htmlFor="balance-history-import-file"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Monarch balance history CSV
              </label>
              <input
                ref={fileInputRef}
                id="balance-history-import-file"
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileChange}
                className="w-full text-sm text-gray-600"
              />
              <p className="text-xs text-gray-400 mt-2">
                We&apos;ll show you a preview before anything is saved.
              </p>
            </div>
          )}

          {step === "loading" && (
            <p className="text-sm text-gray-500 text-center py-6">
              {result === null && summary === null ? "Analyzing file…" : "Importing…"}
            </p>
          )}

          {step === "preview" && summary && (
            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-gray-400">Date range</dt>
                  <dd className="text-gray-800 font-medium">
                    {summary.dateRange.from} – {summary.dateRange.to}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-400">Accounts found</dt>
                  <dd className="text-gray-800 font-medium">{summary.accountsFound}</dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-400">New balance events</dt>
                  <dd className="text-gray-800 font-medium">{summary.newEventRows}</dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-400">Duplicates skipped</dt>
                  <dd className="text-gray-800 font-medium">{summary.duplicateEventRows}</dd>
                </div>
              </dl>

              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                  New accounts
                </h3>
                {summary.newAccounts.length === 0 ? (
                  <p className="text-xs text-gray-400">
                    No new accounts — every row matched an existing account.
                  </p>
                ) : (
                  <ul className="text-sm divide-y divide-gray-50 border border-gray-100 rounded-lg">
                    {summary.newAccounts.map((a) => (
                      <li key={a.name} className="flex items-center justify-between px-3 py-1.5">
                        <span className="text-gray-800">{a.name}</span>
                        <span className="text-xs text-gray-400">
                          {ACCOUNT_TYPE_LABELS[a.guessedType]}
                          {a.archived ? " · archived" : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {step === "success" && result && (
            <p className="text-sm text-gray-700 text-center py-4">
              Imported{" "}
              <span className="font-semibold text-gray-900">{result.eventsInserted}</span>{" "}
              new balance history event{result.eventsInserted === 1 ? "" : "s"}.
            </p>
          )}
        </div>

        {step !== "loading" && (
          <div className="px-6 pb-6 flex gap-3">
            {step === "pick" && (
              <button
                onClick={onClose}
                className="flex-1 border border-gray-200 text-gray-700 rounded-lg py-2.5 text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            )}
            {step === "preview" && (
              <>
                <button
                  onClick={onClose}
                  className="flex-1 border border-gray-200 text-gray-700 rounded-lg py-2.5 text-sm font-medium hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirm}
                  className="flex-1 bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-blue-700 transition-colors"
                >
                  Confirm import
                </button>
              </>
            )}
            {step === "success" && (
              <button
                onClick={onClose}
                className="flex-1 bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                Done
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
