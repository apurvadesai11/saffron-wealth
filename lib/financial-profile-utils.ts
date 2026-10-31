// Financial-profile taxonomy and derivations (pure logic — no DB, no React).
// The string unions in lib/types.ts are enforced here in the app layer, the
// same way lib/account-utils.ts enforces AccountType.

import type {
  AccountBucket,
  AccountType,
  FilingStatus,
  FinancialProfile,
  FinancialProfileInput,
  IncomeKind,
  IncomeStream,
  PayFrequency,
} from "./types";
import { getBucketForType } from "./account-utils";
import { roundToCent } from "./money";

export const INCOME_KINDS: IncomeKind[] = [
  "salary",
  "bonus",
  "rsu",
  "espp",
  "rental",
  "self_employment",
  "interest_dividends",
  "other",
];

export const INCOME_KIND_LABELS: Record<IncomeKind, string> = {
  salary: "Salary",
  bonus: "Bonus",
  rsu: "RSUs",
  espp: "ESPP",
  rental: "Rental income",
  self_employment: "Self-employment",
  interest_dividends: "Interest & dividends",
  other: "Other",
};

export const PAY_FREQUENCIES: PayFrequency[] = [
  "weekly",
  "biweekly",
  "semimonthly",
  "monthly",
  "quarterly",
  "semiannual",
  "annual",
  "irregular",
];

export const PAY_FREQUENCY_LABELS: Record<PayFrequency, string> = {
  weekly: "Weekly",
  biweekly: "Every two weeks",
  semimonthly: "Twice a month",
  monthly: "Monthly",
  quarterly: "Quarterly",
  semiannual: "Twice a year",
  annual: "Once a year",
  irregular: "Irregular",
};

// What a new stream of each kind is usually paid on, so adding one starts
// from a sensible frequency. A suggestion only — the user can change it.
export const DEFAULT_FREQUENCY_BY_KIND: Record<IncomeKind, PayFrequency | null> = {
  salary: "biweekly",
  bonus: "annual",
  rsu: "quarterly",
  espp: "semiannual",
  rental: "monthly",
  self_employment: "irregular",
  interest_dividends: "quarterly",
  other: null,
};

export const FILING_STATUSES: FilingStatus[] = [
  "single",
  "married_joint",
  "married_separate",
  "head_of_household",
  "qualifying_surviving_spouse",
];

export const FILING_STATUS_LABELS: Record<FilingStatus, string> = {
  single: "Single",
  married_joint: "Married filing jointly",
  married_separate: "Married filing separately",
  head_of_household: "Head of household",
  qualifying_surviving_spouse: "Qualifying surviving spouse",
};

export function isIncomeKind(value: unknown): value is IncomeKind {
  return typeof value === "string" && (INCOME_KINDS as string[]).includes(value);
}

export function isPayFrequency(value: unknown): value is PayFrequency {
  return typeof value === "string" && (PAY_FREQUENCIES as string[]).includes(value);
}

export function isFilingStatus(value: unknown): value is FilingStatus {
  return typeof value === "string" && (FILING_STATUSES as string[]).includes(value);
}

// Where a planned contribution can go. Debt is excluded because paying it
// down is loan tracking's question (roadmap #5), and a property's value isn't
// something you contribute to.
export const CONTRIBUTION_BUCKETS: AccountBucket[] = ["cash", "investments", "retirement"];

export function isContributionEligible(type: AccountType): boolean {
  return CONTRIBUTION_BUCKETS.includes(getBucketForType(type));
}

// Milliseconds since the start of the instant's UTC month — comparable across
// years for the same month, which is what an anniversary check needs.
function sinceMonthStart(d: Date): number {
  return d.getTime() - Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

/**
 * The age a saved version implies at `on`: the typed age plus the whole years
 * elapsed since it was saved. Lags the true age by under a year, never leads
 * it. See docs/decisions/0014-age-anchored-to-effective-date.md.
 */
export function ageOn(
  profile: Pick<FinancialProfile, "ageAtEffective" | "effectiveAt">,
  on: Date,
): number {
  const saved = new Date(profile.effectiveAt);
  const beforeAnniversary =
    on.getUTCMonth() < saved.getUTCMonth() ||
    (on.getUTCMonth() === saved.getUTCMonth() && sinceMonthStart(on) < sinceMonthStart(saved));
  const years = on.getUTCFullYear() - saved.getUTCFullYear() - (beforeAnniversary ? 1 : 0);
  return profile.ageAtEffective + Math.max(0, years);
}

export function totalAnnualIncome(streams: Pick<IncomeStream, "annualAmount">[]): number {
  return roundToCent(streams.reduce((sum, s) => sum + s.annualAmount, 0));
}

// A saved version restated in the shape a save would send, with today's
// derived age — what the form pre-fills and what an incoming save is compared
// against.
export function toProfileInput(profile: FinancialProfile, on: Date): FinancialProfileInput {
  return {
    age: ageOn(profile, on),
    targetRetirementAge: profile.targetRetirementAge,
    expectedRealReturnPct: profile.expectedRealReturnPct,
    safeWithdrawalRatePct: profile.safeWithdrawalRatePct,
    inflationPct: profile.inflationPct,
    filingStatus: profile.filingStatus,
    employerMatch: profile.employerMatch,
    incomeStreams: profile.incomeStreams,
    contributionTargets: profile.contributionTargets,
  };
}

// Fixed key order, so two inputs built by different code paths serialize the
// same way when they mean the same thing.
function canonical(input: FinancialProfileInput): string {
  return JSON.stringify([
    input.age,
    input.targetRetirementAge,
    input.expectedRealReturnPct,
    input.safeWithdrawalRatePct,
    input.inflationPct,
    input.filingStatus,
    input.employerMatch && [input.employerMatch.matchPct, input.employerMatch.limitPct],
    input.incomeStreams.map((s) => [s.kind, s.label, s.annualAmount, s.frequency]),
    input.contributionTargets.map((c) => [c.accountId, c.annualAmount]),
  ]);
}

/**
 * Whether a save would change anything. Order-sensitive on both lists: the
 * order is what the user sees, so a reorder is an edit. See
 * docs/decisions/0013-financial-profile-append-only-versions.md.
 */
export function profileInputsEqual(a: FinancialProfileInput, b: FinancialProfileInput): boolean {
  return canonical(a) === canonical(b);
}
