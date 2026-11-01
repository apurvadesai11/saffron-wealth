"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import type { FireInputs, FireLevers, FirePageState } from "@/lib/types";
import {
  annualContribution,
  coastFiNumber,
  coastLine,
  defaultLevers,
  fiNumber,
  hasIncome,
  hasTaxRate,
  leverRanges,
  leversEqual,
  realReturn,
  savingsRatePct,
  spendingForSavingsRate,
  stockShare,
  type ReadyLevers,
} from "@/lib/fire-levers";
import {
  blendReturns,
  horizonYears,
  recenterReturns,
  simulateWindows,
  summarize,
} from "@/lib/fire-simulation";
import { ANNUAL_REAL_RETURNS } from "@/lib/market-history-data";
import { formatUsd } from "@/lib/money";
import FireAssumptions, { ALLOCATION_HINT } from "./FireAssumptions";
import FireChart, { plotEndYear } from "./FireChart";
import FireLeverSlider from "./FireLeverSlider";
import FireScenarioTable, { formatYears } from "./FireScenarioTable";

// The tax-rate gate. Nothing else in the page may run before the user has
// given a rate, so an unusable entry reads as "no rate yet" rather than as 0.
const TAX_RATE_MIN = 0;
const TAX_RATE_MAX = 60;

// Null for an empty or unparseable entry and for one outside the allowed
// range. fire-levers' own grid cleaning would turn NaN into 0, which would
// quietly open the gate on a rate nobody typed.
function parseTaxRate(text: string): number | null {
  if (text.trim() === "") return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= TAX_RATE_MIN && value <= TAX_RATE_MAX ? value : null;
}

// Percents with up to two decimals and no trailing zeros: 7.1000000000000005
// reads "7.1%", 4 reads "4%".
function formatPct(value: number): string {
  return `${Number(value.toFixed(2))}%`;
}

function formatAllocation(stocksPct: number): string {
  return `${stocksPct}% stocks / ${100 - stocksPct}% bonds`;
}

const labelClass = "block text-sm font-medium text-fg-secondary mb-1";
const controlClass =
  "w-full border border-line rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-accent-ring";
const cardClass = "bg-surface rounded-2xl shadow-sm p-6";

function EmptyState({ href, children }: { href: string; children: ReactNode }) {
  return (
    <div className={`${cardClass} text-center`}>
      <Link href={href} className="text-sm font-medium text-accent hover:underline">
        {children}
      </Link>
    </div>
  );
}

// The rate commits on submit, not on every keystroke: "2" on the way to "25" is
// a valid rate, and committing it would swap this form for the results and
// drop the focus before the second digit arrived.
function TaxRatePrompt({ onSet }: { onSet: (pct: number) => void }) {
  const [text, setText] = useState("");
  // Set by a submit that could not be used; cleared as soon as the entry changes.
  const [rejected, setRejected] = useState(false);

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const rate = parseTaxRate(text);
        if (rate === null) setRejected(true);
        else onSet(rate);
      }}
      className={`${cardClass} max-w-md space-y-3`}
    >
      <p className="text-sm text-fg-muted">
        Your savings come from your Financial Profile income after tax, so the calculator needs a
        tax rate to start from.
      </p>
      <div>
        <label htmlFor="fire-tax-prompt" className={labelClass}>
          Effective tax rate (%)
        </label>
        <div className="flex items-center gap-3">
          <input
            id="fire-tax-prompt"
            type="number"
            inputMode="decimal"
            min={TAX_RATE_MIN}
            max={TAX_RATE_MAX}
            step="any"
            value={text}
            aria-invalid={rejected ? true : undefined}
            onChange={(e) => {
              setText(e.target.value);
              setRejected(false);
            }}
            className={controlClass}
          />
          <button
            type="submit"
            className="shrink-0 bg-accent-solid text-on-solid rounded-lg py-2 px-4 text-sm font-medium hover:bg-accent-solid-hover transition-colors"
          >
            Calculate
          </button>
        </div>
        <p className="text-xs text-fg-faint mt-1.5">We couldn&apos;t estimate this from your transactions.</p>
        {rejected && (
          <p className="text-xs text-danger-muted mt-1.5">
            Enter a rate from {TAX_RATE_MIN} to {TAX_RATE_MAX}.
          </p>
        )}
      </div>
    </form>
  );
}

// A named region, so the figure inside it can be found by what it is.
// min-w-0 lets a grid cell narrower than its figure shrink instead of pushing
// out of the row, and break-words wraps the figure rather than letting it
// overflow: a backstop, since the figures are whole dollars to begin with.
function HeadlineCard({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section
      aria-labelledby={id}
      className="min-w-0 break-words bg-surface rounded-xl p-4 shadow-sm border border-line-subtle"
    >
      <h2 id={id} className="text-sm text-fg-muted mb-1">
        {title}
      </h2>
      {children}
    </section>
  );
}

// Headline figures are whole dollars: cents on a seven-figure FI number
// overflow a quarter-width card, and no decision turns on them. The
// assumptions panel keeps the cents.
const headlineValueClass = "text-2xl font-bold text-fg";
const headlineNoteClass = "text-sm text-fg-muted mt-1";

type View = "fi" | "coast";

const VIEWS: { key: View; label: string }[] = [
  { key: "fi", label: "Years to FI" },
  { key: "coast", label: "Coast FI" },
];

interface ResultsProps {
  inputs: FireInputs;
  levers: ReadyLevers;
  defaults: FireLevers;
  onChange: (patch: Partial<FireLevers>) => void;
  onReset: () => void;
}

// Everything that needs a tax rate, so the simulation's hooks run only once
// the page has one.
function FireResults({ inputs, levers, defaults, onChange, onReset }: ResultsProps) {
  const [view, setView] = useState<View>("fi");

  const yearsToTarget = inputs.targetRetirementAge - inputs.age;
  const horizon = horizonYears(inputs.age, inputs.targetRetirementAge);
  const fi = fiNumber(levers);
  const real = realReturn(levers);

  // The expensive part: every historical window, replayed. It depends on the
  // levers and nothing else the page changes (the tab, in particular), so a
  // tab switch reuses it.
  const summary = useMemo(() => {
    const returns = recenterReturns(
      blendReturns(ANNUAL_REAL_RETURNS, stockShare(levers)),
      realReturn(levers),
    );
    const results = simulateWindows({
      portfolio: inputs.portfolio.total,
      contribution: annualContribution(inputs, levers),
      fiNumber: fiNumber(levers),
      yearsToTarget,
      horizon,
      returns,
      firstYear: ANNUAL_REAL_RETURNS[0].year,
    });
    return summarize(results, yearsToTarget);
  }, [inputs, levers, yearsToTarget, horizon]);

  const ranges = leverRanges(inputs, defaults, levers);
  const savingsRate = savingsRatePct(inputs, levers);
  const defaultSavingsRate = hasTaxRate(defaults) ? savingsRatePct(inputs, defaults) : null;
  // The savings slider is a view of spending, and the tax rate moves it too,
  // so it counts as modified when either has taken it off its starting value.
  const savingsModified =
    levers.annualSpending !== defaults.annualSpending ||
    (defaultSavingsRate !== null && savingsRate !== defaultSavingsRate);

  const neutral = summary.fi.find((row) => row.label === "Neutral");
  const neutralYears = neutral?.years ?? null;

  // A target at or before today leaves no "by the target" to coast to.
  const coastNeeded = coastFiNumber(fi, real, yearsToTarget);

  // The chart stops a few years past the slowest start's FI crossing, so the
  // crossing is legible; the band, the coast curve, the y range and the
  // chart's aria-label all come from the plotted years only.
  const worstFiYears = summary.fi.find((row) => row.label === "Worst")?.years ?? null;
  const plotEnd = plotEndYear({ horizon, yearsToTarget, worstFiYears, view });
  const plottedBands = summary.bands.slice(0, plotEnd + 1);
  const plottedCoast = coastLine(fi, real, yearsToTarget, horizon)?.slice(0, plotEnd + 1) ?? null;

  const history = {
    windowCount: summary.windowCount,
    firstStartYear: summary.firstStartYear,
    lastStartYear: summary.lastStartYear,
    horizon,
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <HeadlineCard id="fire-card-fi" title="FI number">
          <p className={headlineValueClass}>{formatUsd(fi, { wholeDollars: true })}</p>
          <p className={headlineNoteClass}>
            {formatUsd(levers.annualSpending, { wholeDollars: true })} a year at a{" "}
            {formatPct(levers.safeWithdrawalRatePct)} withdrawal rate
          </p>
        </HeadlineCard>

        <HeadlineCard id="fire-card-portfolio" title="Investable portfolio">
          <p className={headlineValueClass}>{formatUsd(inputs.portfolio.total, { wholeDollars: true })}</p>
          {fi > 0 && (
            <p className={headlineNoteClass}>
              {Math.round((inputs.portfolio.total / fi) * 100)}% of your FI number
            </p>
          )}
        </HeadlineCard>

        <HeadlineCard id="fire-card-years" title="Years to FI">
          <p className={headlineValueClass}>{formatYears(neutralYears, horizon)}</p>
          <p className={headlineNoteClass}>
            {neutralYears === null
              ? "Neutral historical scenario"
              : `Neutral scenario · FI at age ${Math.floor(inputs.age + neutralYears)}`}
          </p>
        </HeadlineCard>

        <HeadlineCard id="fire-card-coast" title="Coast FI number">
          {coastNeeded === null ? (
            <p className={headlineValueClass}>Past your target age</p>
          ) : (
            <>
              <p className={headlineValueClass}>{formatUsd(coastNeeded, { wholeDollars: true })}</p>
              <p className={headlineNoteClass}>
                {inputs.portfolio.total >= coastNeeded ? "Reached now" : "Not reached yet"}
              </p>
              <p className="text-xs text-fg-faint mt-1">
                The amount that would grow to your FI number by {inputs.targetRetirementAge} with no more
                saving, at your assumed return
              </p>
            </>
          )}
        </HeadlineCard>
      </div>

      <section aria-labelledby="fire-levers-heading" className={`${cardClass} space-y-5`}>
        <div className="flex items-center justify-between gap-3">
          <h2 id="fire-levers-heading" className="text-base font-semibold text-fg">
            Adjust the plan
          </h2>
          <button
            type="button"
            onClick={onReset}
            disabled={leversEqual(levers, defaults)}
            className="px-3 py-1.5 rounded-lg border border-line text-sm font-medium text-fg-secondary hover:bg-surface-sunken transition-colors disabled:opacity-50 disabled:hover:bg-transparent"
          >
            Reset to defaults
          </button>
        </div>
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
          <FireLeverSlider
            id="fire-savings-rate"
            label="Savings rate"
            value={savingsRate ?? 0}
            {...ranges.savingsRatePct}
            format={(v) => (savingsRate === null ? "—" : formatPct(v))}
            onChange={(pct) => onChange({ annualSpending: spendingForSavingsRate(inputs, levers, pct) })}
            modified={savingsModified}
            disabled={savingsRate === null}
            hint={savingsRate === null ? "No income in your Financial Profile" : undefined}
          />
          <FireLeverSlider
            id="fire-tax-rate"
            label="Effective tax rate"
            value={levers.effectiveTaxRatePct}
            {...ranges.effectiveTaxRatePct}
            format={formatPct}
            onChange={(v) => onChange({ effectiveTaxRatePct: v })}
            modified={
              defaults.effectiveTaxRatePct !== null &&
              levers.effectiveTaxRatePct !== defaults.effectiveTaxRatePct
            }
            disabled={!hasIncome(inputs)}
            hint={hasIncome(inputs) ? undefined : "No income in your Financial Profile"}
          />
          <FireLeverSlider
            id="fire-nominal-return"
            label="Nominal return"
            value={levers.nominalReturnPct}
            {...ranges.nominalReturnPct}
            format={formatPct}
            onChange={(v) => onChange({ nominalReturnPct: v })}
            modified={levers.nominalReturnPct !== defaults.nominalReturnPct}
          />
          <FireLeverSlider
            id="fire-inflation"
            label="Inflation"
            value={levers.inflationPct}
            {...ranges.inflationPct}
            format={formatPct}
            onChange={(v) => onChange({ inflationPct: v })}
            modified={levers.inflationPct !== defaults.inflationPct}
          />
          <FireLeverSlider
            id="fire-withdrawal-rate"
            label="Safe withdrawal rate"
            value={levers.safeWithdrawalRatePct}
            {...ranges.safeWithdrawalRatePct}
            format={formatPct}
            onChange={(v) => onChange({ safeWithdrawalRatePct: v })}
            modified={levers.safeWithdrawalRatePct !== defaults.safeWithdrawalRatePct}
          />
          <FireLeverSlider
            id="fire-stock-allocation"
            label="Stock allocation"
            value={levers.stockAllocationPct}
            {...ranges.stockAllocationPct}
            format={formatAllocation}
            onChange={(v) => onChange({ stockAllocationPct: v })}
            modified={levers.stockAllocationPct !== defaults.stockAllocationPct}
            hint={ALLOCATION_HINT}
          />
        </div>
      </section>

      <section aria-labelledby="fire-projection-heading" className={`${cardClass} space-y-4`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="fire-projection-heading" className="text-base font-semibold text-fg">
              Projection
            </h2>
            <p className="text-sm text-fg-muted mt-0.5">In today&apos;s dollars</p>
          </div>
          <div role="tablist" aria-label="Milestone" className="flex gap-1">
            {VIEWS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                role="tab"
                id={`fire-tab-${key}`}
                aria-selected={view === key}
                aria-controls="fire-view-panel"
                data-state={view === key ? "active" : "inactive"}
                onClick={() => setView(key)}
                className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                  view === key ? "bg-surface-muted text-fg" : "text-fg-faint hover:text-fg-secondary"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div role="tabpanel" id="fire-view-panel" aria-labelledby={`fire-tab-${view}`} className="space-y-4">
          <FireChart
            bands={plottedBands}
            age={inputs.age}
            fiNumber={fi}
            coastLine={plottedCoast}
            view={view}
          />
          {view === "coast" && coastNeeded === null ? (
            <p className="text-sm text-fg-muted">
              Coast FI is measured against your target age, and you are at or past it.
            </p>
          ) : (
            <FireScenarioTable
              rows={view === "fi" ? summary.fi : summary.coast}
              view={view}
              age={inputs.age}
              targetRetirementAge={inputs.targetRetirementAge}
              pastTarget={yearsToTarget < 0}
              asOf={inputs.asOf}
              horizon={horizon}
              windowCount={summary.windowCount}
              firstStartYear={summary.firstStartYear}
              lastStartYear={summary.lastStartYear}
              share={view === "fi" ? summary.reachedByTargetShare : summary.coastNowShare}
            />
          )}
        </div>
      </section>

      <section aria-labelledby="fire-assumptions-heading" className={cardClass}>
        <h2 id="fire-assumptions-heading" className="text-base font-semibold text-fg mb-2">
          Assumptions
        </h2>
        <FireAssumptions inputs={inputs} levers={levers} defaults={defaults} history={history} />
      </section>
    </div>
  );
}

function FireCalculator({ inputs }: { inputs: FireInputs }) {
  // "Modified" and "reset" both mean "back to the starting point": what the
  // data said, plus a tax rate the user had to supply because the data had
  // none. A submitted rate joins the defaults, so Reset keeps it instead of
  // asking for it again, and moving off it reads as an adjustment of it.
  const [defaults, setDefaults] = useState(() => defaultLevers(inputs));
  const [levers, setLevers] = useState<FireLevers>(defaults);

  if (!hasTaxRate(levers)) {
    return (
      <TaxRatePrompt
        onSet={(pct) => {
          setDefaults((prev) => ({ ...prev, effectiveTaxRatePct: pct }));
          setLevers((prev) => ({ ...prev, effectiveTaxRatePct: pct }));
        }}
      />
    );
  }
  return (
    <FireResults
      inputs={inputs}
      levers={levers}
      defaults={defaults}
      onChange={(patch) => setLevers((prev) => ({ ...prev, ...patch }))}
      onReset={() => setLevers(defaults)}
    />
  );
}

export default function FireCalculatorClient({ page }: { page: FirePageState }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-fg">FIRE Calculator</h1>
        <p className="text-sm text-fg-muted mt-1">
          How long your plan takes to reach financial independence, replayed against every rolling stretch
          of US market history since {ANNUAL_REAL_RETURNS[0].year}.
        </p>
      </div>

      {page.state === "no-profile" && (
        <EmptyState href="/financial-profile">Add your Financial Profile to see your FIRE numbers</EmptyState>
      )}
      {page.state === "no-spending" && (
        <EmptyState href="/transactions">Add or import transactions to estimate your spending</EmptyState>
      )}
      {page.state === "ready" && <FireCalculator inputs={page.inputs} />}
    </div>
  );
}
