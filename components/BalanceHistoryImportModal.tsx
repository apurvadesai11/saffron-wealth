"use client";

import { useEffect, useRef, useState } from "react";
// Type-only import — erased at compile time, so this pulls in none of
// lib/balance-history-import.ts's Prisma-adjacent value imports at runtime.
// Mirrors MonarchImportModal.tsx's identical use of ImportSummary.
import type { BalanceHistoryImportSummary } from "@/lib/balance-history-import";
import { ACCOUNT_TYPE_LABELS } from "@/lib/account-utils";
import { readCsrfCookie } from "@/lib/auth/csrf-client";
import { CSRF_HEADER_NAME } from "@/lib/auth/csrf-shared";
import { useFocusTrap } from "@/lib/use-focus-trap";

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

  // Accounts the import could not classify from their names. Derived rather
  // than added to the server summary: newAccounts already carries every
  // guessedType, so a second count on the wire would be one more thing that
  // could disagree with the list beside it.
  const uncategorizedCount =
    summary?.newAccounts.filter((a) => a.guessedType === "uncategorized").length ?? 0;
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // Confines Tab to this dialog and restores focus to whatever opened it.
  useFocusTrap(dialogRef);

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40 px-4"
      onClick={step === "loading" ? undefined : onClose}
      aria-label="Close modal"
    >
      <div
        ref={dialogRef}
        className="bg-surface rounded-2xl shadow-xl w-full max-w-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="balance-history-import-title"
        data-import-step={step}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-4 border-b border-line-subtle">
          <div className="flex items-start justify-between">
            <h2 id="balance-history-import-title" className="text-xl font-bold text-fg">
              Import Balance History
            </h2>
            {step !== "loading" && (
              <button
                onClick={onClose}
                className="text-fg-disabled hover:text-fg-muted transition-colors text-2xl leading-none mt-0.5"
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
              className="text-sm text-danger bg-danger-soft border border-danger-line-soft rounded-lg px-4 py-2"
            >
              {error}
            </p>
          )}

          {step === "pick" && (
            <div>
              <label
                htmlFor="balance-history-import-file"
                className="block text-sm font-medium text-fg-secondary mb-2"
              >
                Monarch balance history CSV
              </label>
              <input
                ref={fileInputRef}
                id="balance-history-import-file"
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileChange}
                className="w-full text-sm text-fg-tertiary"
              />
              <p className="text-xs text-fg-faint mt-2">
                We&apos;ll show you a preview before anything is saved.
              </p>
            </div>
          )}

          {step === "loading" && (
            <p className="text-sm text-fg-muted text-center py-6">
              {result === null && summary === null ? "Analyzing file…" : "Importing…"}
            </p>
          )}

          {step === "preview" && summary && (
            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-fg-faint">Date range</dt>
                  <dd className="text-fg-soft font-medium">
                    {summary.dateRange.from} – {summary.dateRange.to}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-fg-faint">Accounts found</dt>
                  <dd className="text-fg-soft font-medium">{summary.accountsFound}</dd>
                </div>
                <div>
                  <dt className="text-xs text-fg-faint">New balance events</dt>
                  <dd className="text-fg-soft font-medium">{summary.newEventRows}</dd>
                </div>
                <div>
                  <dt className="text-xs text-fg-faint">Duplicates skipped</dt>
                  <dd className="text-fg-soft font-medium">{summary.duplicateEventRows}</dd>
                </div>
              </dl>

              {summary.typeConflicts.length > 0 && (
                <div data-testid="type-conflicts">
                  <h3 className="text-xs font-semibold text-fg-muted uppercase tracking-wide mb-1.5">
                    Type disagreements
                  </h3>
                  <ul className="text-sm divide-y divide-warning-line-soft border border-warning-line bg-warning-soft rounded-lg">
                    {summary.typeConflicts.map((c) => (
                      <li key={c.name} className="px-3 py-1.5">
                        <span className="text-fg-soft">{c.name}</span>
                        <span className="block text-xs text-fg-muted">
                          {/* When the name matches no rule the suggestion is
                              'uncategorized', which is not a suggestion —
                              saying "looks like Uncategorized" would be
                              nonsense. The sign disagreement is still the
                              thing worth reporting. */}
                          {c.suggestedType === "uncategorized" ? (
                            <>
                              Saved as {ACCOUNT_TYPE_LABELS[c.storedType]}, but this
                              file&apos;s balance has the opposite sign, and the name
                              doesn&apos;t say what it is
                            </>
                          ) : (
                            <>
                              Saved as {ACCOUNT_TYPE_LABELS[c.storedType]}, but this
                              file&apos;s balance looks like{" "}
                              {ACCOUNT_TYPE_LABELS[c.suggestedType]}
                            </>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-fg-faint mt-1.5">
                    The import won&apos;t change these types. If the file is right, edit the
                    account after importing.
                  </p>
                </div>
              )}

              <div>
                <h3 className="text-xs font-semibold text-fg-muted uppercase tracking-wide mb-1.5">
                  New accounts
                </h3>
                {summary.newAccounts.length === 0 ? (
                  <p className="text-xs text-fg-faint">
                    No new accounts — every row matched an existing account.
                  </p>
                ) : (
                  <ul className="text-sm divide-y divide-line-faint border border-line-subtle rounded-lg">
                    {summary.newAccounts.map((a) => (
                      <li
                        key={a.name}
                        className="flex items-center justify-between px-3 py-1.5"
                        data-uncategorized={a.guessedType === "uncategorized" ? "true" : undefined}
                      >
                        <span className="text-fg-soft">{a.name}</span>
                        <span
                          className={
                            a.guessedType === "uncategorized"
                              ? "text-xs text-warning-strong"
                              : "text-xs text-fg-faint"
                          }
                        >
                          {ACCOUNT_TYPE_LABELS[a.guessedType]}
                          {a.archived ? " · archived" : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {/* The import could not tell what these are. Counting an
                    unrecognized account as an asset would inflate net worth
                    with a number nobody confirmed, so they are held out of the
                    totals until their owner says what they are. */}
                {uncategorizedCount > 0 && (
                  <p className="text-xs text-warning-strong mt-1.5" data-testid="uncategorized-note">
                    {uncategorizedCount === 1
                      ? "1 account couldn't be classified from its name."
                      : `${uncategorizedCount} accounts couldn't be classified from their names.`}{" "}
                    They&apos;re excluded from your net worth until you set a type — edit them
                    on the Net Worth page after importing.
                  </p>
                )}
              </div>
            </div>
          )}

          {step === "success" && result && (
            <p className="text-sm text-fg-secondary text-center py-4">
              Imported{" "}
              <span className="font-semibold text-fg">{result.eventsInserted}</span>{" "}
              new balance history event{result.eventsInserted === 1 ? "" : "s"}.
            </p>
          )}
        </div>

        {step !== "loading" && (
          <div className="px-6 pb-6 flex gap-3">
            {step === "pick" && (
              <button
                onClick={onClose}
                className="flex-1 border border-line text-fg-secondary rounded-lg py-2.5 text-sm font-medium hover:bg-surface-sunken transition-colors"
              >
                Cancel
              </button>
            )}
            {step === "preview" && (
              <>
                <button
                  onClick={onClose}
                  className="flex-1 border border-line text-fg-secondary rounded-lg py-2.5 text-sm font-medium hover:bg-surface-sunken transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirm}
                  className="flex-1 bg-accent-solid text-on-solid rounded-lg py-2.5 text-sm font-medium hover:bg-accent-solid-hover transition-colors"
                >
                  Confirm import
                </button>
              </>
            )}
            {step === "success" && (
              <button
                onClick={onClose}
                className="flex-1 bg-accent-solid text-on-solid rounded-lg py-2.5 text-sm font-medium hover:bg-accent-solid-hover transition-colors"
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
