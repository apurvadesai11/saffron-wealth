"use client";

import { useState, type ReactNode } from "react";
import type { FilingStatus, FinancialProfile } from "@/lib/types";
import { FILING_STATUSES, FILING_STATUS_LABELS } from "@/lib/financial-profile-utils";
import { parseFinancialProfileBody, parseNumberInput } from "@/lib/financial-profile-validation";
import { readCsrfCookie } from "@/lib/auth/csrf-client";
import { CSRF_HEADER_NAME } from "@/lib/auth/csrf-shared";
import IncomeStreamsEditor, {
  incomeDraftFrom,
  newIncomeDraft,
  type IncomeDraft,
} from "./IncomeStreamsEditor";
import ContributionTargetsEditor, {
  contributionDraftFrom,
  type ContributionAccountOption,
  type ContributionDraft,
} from "./ContributionTargetsEditor";

interface Props {
  initialProfile: FinancialProfile | null;
  // Derived on the server with ageOn(), so the field doesn't change between
  // the server render and hydration.
  initialAge: number | null;
  accounts: ContributionAccountOption[];
}

const controlClass =
  "w-full border border-line rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-accent-ring";
// The employer-match inputs sit inside a sentence, so they size to their
// content rather than filling the row the way controlClass does.
const inlineControlClass =
  "w-20 border border-line rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-accent-ring";
const labelClass = "block text-sm font-medium text-fg-secondary mb-1";
const hintClass = "text-xs text-fg-faint mt-1.5";
const errorClass = "text-xs text-danger-muted mt-1.5";

const savedDate = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

function text(n: number | undefined | null): string {
  return n === undefined || n === null ? "" : String(n);
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="bg-surface rounded-2xl shadow-sm p-6 space-y-4">
      <div>
        <h2 className="text-base font-semibold text-fg">{title}</h2>
        <p className="text-sm text-fg-muted mt-0.5">{description}</p>
      </div>
      {children}
    </section>
  );
}

function Field(props: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  suffix?: string;
}) {
  const { id, label, value, onChange, error, hint, suffix } = props;
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          aria-invalid={error ? true : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={suffix ? `${controlClass} pr-8` : controlClass}
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-muted text-sm">{suffix}</span>
        )}
      </div>
      {error ? <p className={errorClass}>{error}</p> : hint && <p className={hintClass}>{hint}</p>}
    </div>
  );
}

export default function FinancialProfileClient({ initialProfile, initialAge, accounts }: Props) {
  const p = initialProfile;
  const [profile, setProfile] = useState<FinancialProfile | null>(p);

  const [age, setAge] = useState(text(initialAge));
  const [retirementAge, setRetirementAge] = useState(text(p?.targetRetirementAge));
  const [filingStatus, setFilingStatus] = useState<FilingStatus | "">(p?.filingStatus ?? "");
  const [incomeRows, setIncomeRows] = useState<IncomeDraft[]>(() =>
    p ? p.incomeStreams.map(incomeDraftFrom) : [newIncomeDraft()],
  );
  // No defaults for the assumptions: a pre-filled number the user never
  // looked at is exactly the undeclared input this page exists to replace.
  const [returnPct, setReturnPct] = useState(text(p?.expectedRealReturnPct));
  const [swrPct, setSwrPct] = useState(text(p?.safeWithdrawalRatePct));
  const [inflationPct, setInflationPct] = useState(text(p?.inflationPct));
  const [matchPct, setMatchPct] = useState(text(p?.employerMatch?.matchPct));
  const [matchLimitPct, setMatchLimitPct] = useState(text(p?.employerMatch?.limitPct));
  const [contributionRows, setContributionRows] = useState<ContributionDraft[]>(() =>
    p ? p.contributionTargets.map(contributionDraftFrom) : [],
  );

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function buildBody() {
    const noMatch = matchPct.trim() === "" && matchLimitPct.trim() === "";
    return {
      age: parseNumberInput(age),
      targetRetirementAge: parseNumberInput(retirementAge),
      expectedRealReturnPct: parseNumberInput(returnPct),
      safeWithdrawalRatePct: parseNumberInput(swrPct),
      inflationPct: parseNumberInput(inflationPct),
      filingStatus: filingStatus === "" ? null : filingStatus,
      employerMatch: noMatch
        ? null
        : { matchPct: parseNumberInput(matchPct), limitPct: parseNumberInput(matchLimitPct) },
      incomeStreams: incomeRows.map((r) => ({
        kind: r.kind,
        label: r.label,
        annualAmount: parseNumberInput(r.annualAmount),
        frequency: r.frequency === "" ? null : r.frequency,
      })),
      contributionTargets: contributionRows.map((r) => ({
        accountId: r.accountId,
        annualAmount: parseNumberInput(r.annualAmount),
      })),
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setStatus(null);

    // The same parser the route runs, so the form never sends something the
    // server will refuse for a reason it could have shown here.
    const parsed = parseFinancialProfileBody(buildBody());
    if (!parsed.ok) {
      setFieldErrors(parsed.fieldErrors);
      setFormError("Please correct the errors and try again.");
      return;
    }
    setFieldErrors({});

    setSaving(true);
    try {
      const res = await fetch("/api/financial-profile", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          [CSRF_HEADER_NAME]: readCsrfCookie() ?? "",
        },
        body: JSON.stringify(parsed.value),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFieldErrors(data?.error?.fieldErrors ?? {});
        setFormError(data?.error?.message ?? "Save failed.");
        return;
      }
      const saved = data.data.profile as FinancialProfile;
      setProfile(saved);
      setStatus(data.data.changed ? `Saved as version ${saved.version}.` : "No changes to save.");
    } catch {
      setFormError("Network error.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-fg">Financial Profile</h1>
        <p className="text-sm text-fg-muted mt-1">
          The inputs your projections and FIRE math run on. Every save is kept as a dated version,
          so a number worked out from last year&apos;s assumptions can still be explained.
        </p>
        {/* The date is formatted in the viewer's time zone, which the server
            render can't know; the browser's value wins on hydration. */}
        <p className="text-xs text-fg-faint mt-2" suppressHydrationWarning>
          {profile
            ? `Version ${profile.version} · saved ${savedDate.format(new Date(profile.effectiveAt))}`
            : "Not saved yet"}
        </p>
      </div>

      <form aria-label="Financial profile" noValidate onSubmit={handleSubmit} className="space-y-6">
        <Section title="About you" description="Ages are in whole years.">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field
              id="fp-age"
              label="Current age"
              value={age}
              onChange={setAge}
              error={fieldErrors.age}
              hint="Moves forward on its own each year from the day you save."
            />
            <Field
              id="fp-retirement-age"
              label="Target retirement age"
              value={retirementAge}
              onChange={setRetirementAge}
              error={fieldErrors.targetRetirementAge}
            />
            <div>
              <label htmlFor="fp-filing-status" className={labelClass}>
                Filing status
              </label>
              <select
                id="fp-filing-status"
                aria-invalid={fieldErrors.filingStatus ? true : undefined}
                value={filingStatus}
                onChange={(e) => setFilingStatus(e.target.value as FilingStatus | "")}
                className={controlClass}
              >
                <option value="">Not specified</option>
                {FILING_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {FILING_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
              {fieldErrors.filingStatus && <p className={errorClass}>{fieldErrors.filingStatus}</p>}
            </div>
          </div>
        </Section>

        <Section title="Income" description="Gross annual amounts, before tax. One row per source.">
          <IncomeStreamsEditor rows={incomeRows} errors={fieldErrors} onChange={setIncomeRows} />
        </Section>

        <Section title="Assumptions" description="Long-run averages, not predictions. You can change them any time.">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field
              id="fp-return"
              label="Expected real return"
              suffix="%"
              value={returnPct}
              onChange={setReturnPct}
              error={fieldErrors.expectedRealReturnPct}
              hint="Per year, after inflation."
            />
            <Field
              id="fp-swr"
              label="Safe withdrawal rate"
              suffix="%"
              value={swrPct}
              onChange={setSwrPct}
              error={fieldErrors.safeWithdrawalRatePct}
              hint="The share of your portfolio you'd draw in the first year of retirement."
            />
            <Field
              id="fp-inflation"
              label="Inflation"
              suffix="%"
              value={inflationPct}
              onChange={setInflationPct}
              error={fieldErrors.inflationPct}
              hint="Per year. Turns today's dollars into future ones."
            />
          </div>
        </Section>

        <Section title="Savings" description="Optional. Leave blank what doesn't apply.">
          <div>
            <p className={labelClass}>Employer match</p>
            <div className="flex flex-wrap items-center gap-2 text-sm text-fg-secondary">
              <span>Matches</span>
              <input
                type="text"
                inputMode="decimal"
                aria-label="Employer match (% of your contributions)"
                aria-invalid={fieldErrors["employerMatch.matchPct"] ? true : undefined}
                value={matchPct}
                onChange={(e) => setMatchPct(e.target.value)}
                className={inlineControlClass}
              />
              <span>% of your contributions, up to</span>
              <input
                type="text"
                inputMode="decimal"
                aria-label="Employer match limit (% of salary)"
                aria-invalid={fieldErrors["employerMatch.limitPct"] ? true : undefined}
                value={matchLimitPct}
                onChange={(e) => setMatchLimitPct(e.target.value)}
                className={inlineControlClass}
              />
              <span>% of salary</span>
            </div>
            {["employerMatch", "employerMatch.matchPct", "employerMatch.limitPct"].map(
              (key) => fieldErrors[key] && <p key={key} className={errorClass}>{fieldErrors[key]}</p>,
            )}
          </div>

          <div>
            <p className={labelClass}>Contribution targets</p>
            <p className={`${hintClass} mt-0 mb-2`}>What you plan to put into each account per year.</p>
            <ContributionTargetsEditor
              rows={contributionRows}
              accounts={accounts}
              errors={fieldErrors}
              onChange={setContributionRows}
            />
          </div>
        </Section>

        {formError && (
          <p className="text-sm text-danger bg-danger-soft border border-danger-line-soft rounded-lg px-4 py-2">
            {formError}
          </p>
        )}

        <div className="flex items-center justify-end gap-4">
          {status && (
            <p role="status" className="text-sm text-fg-muted">
              {status}
            </p>
          )}
          <button
            type="submit"
            disabled={saving}
            className="bg-accent-solid text-on-solid rounded-lg py-2 px-5 text-sm font-medium hover:bg-accent-solid-hover transition-colors disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save profile"}
          </button>
        </div>
      </form>
    </div>
  );
}
