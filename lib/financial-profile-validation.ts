// Hand-rolled body parser for PUT /api/financial-profile (no Zod — matches the
// house style in lib/account-validation.ts). Pure, so the client form runs the
// same rules before sending and the two can't drift.
//
// Field-error keys follow the input's shape: `age`, `employerMatch.limitPct`,
// `incomeStreams.1.annualAmount`, ... The form renders against these.

import type {
  ContributionTarget,
  EmployerMatch,
  FilingStatus,
  FinancialProfileInput,
  IncomeStream,
} from "./types";
import type { ParseResult } from "./account-validation";
import { isFilingStatus, isIncomeKind, isPayFrequency } from "./financial-profile-utils";

export const AGE_MIN = 16;
export const AGE_MAX = 100;
export const RETURN_MIN = -10;
export const RETURN_MAX = 20;
export const SWR_MAX = 10;
export const INFLATION_MIN = -5;
export const INFLATION_MAX = 20;
export const MATCH_PCT_MAX = 200;
export const MATCH_LIMIT_MAX = 100;
// The largest value Decimal(14, 2) holds; see AMOUNT_MAX in
// lib/transaction-validation.ts for why the bound is inclusive.
export const AMOUNT_MAX = 999_999_999_999.99;
export const LABEL_MAX = 80;
export const MAX_INCOME_STREAMS = 20;
export const MAX_CONTRIBUTION_TARGETS = 50;

/**
 * Round to two decimals the way Postgres stores a JS number in a scale-2
 * numeric column: on the number's decimal text, half away from zero.
 * `Math.round(x * 100) / 100` rounds the binary value instead, so 3.255
 * (really 3.25499…) comes out 3.25 while the database writes 3.26 — and the
 * next identical save would compare unequal to what was stored and mint a new
 * version (docs/decisions/0013-financial-profile-append-only-versions.md).
 */
export function roundToHundredths(value: number): number {
  const magnitude = Math.abs(value);
  const text = String(magnitude);
  // Exponent notation only appears far outside the validated ranges (1e-7,
  // 1e21); the binary rounding is exact enough there.
  const rounded = text.includes("e")
    ? Math.round(magnitude * 100) / 100
    : Math.round(Number(`${text}e2`)) / 100;
  return Math.sign(value) * rounded || 0;
}

/**
 * The form's text → number step, run before the parser. Blank is `undefined`
 * (the parser says "Required."); anything that isn't a plain decimal is NaN
 * (it says "Enter a number."). Separators and `$`/`%` are dropped because
 * people type "90,000" and "3.5%". `Number()` alone would accept "0x10" and
 * "1e3", which nobody means as an amount.
 */
export function parseNumberInput(text: string): number | undefined {
  const cleaned = text.replace(/[\s,$%]/g, "");
  if (cleaned === "") return undefined;
  return /^-?(\d+\.?\d*|\.\d+)$/.test(cleaned) ? Number(cleaned) : NaN;
}

type Errors = Record<string, string>;

// A required number. Records an error and returns undefined when it isn't one.
// NaN arrives from the client form for unparsable text; over JSON it becomes
// null and reads as missing, which is also true.
function readNumber(raw: unknown, key: string, errors: Errors): number | undefined {
  if (raw === undefined || raw === null) {
    errors[key] = "Required.";
    return undefined;
  }
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    errors[key] = "Enter a number.";
    return undefined;
  }
  return raw;
}

function readAge(raw: unknown, key: string, errors: Errors): number {
  const n = readNumber(raw, key, errors);
  if (n === undefined) return 0;
  if (!Number.isInteger(n)) {
    errors[key] = "Enter a whole number.";
  } else if (n < AGE_MIN || n > AGE_MAX) {
    errors[key] = `Enter an age between ${AGE_MIN} and ${AGE_MAX}.`;
  }
  return n;
}

// `min` is exclusive when `minExclusive` is set: a 0% withdrawal rate or a 0%
// match is not an assumption, it's the absence of one.
//
// Both readers bound the *rounded* value, because that is what gets stored:
// checked before rounding, 0.001 passed "above 0%" and was written as 0.00.
function readPercent(
  raw: unknown,
  key: string,
  errors: Errors,
  bounds: { min: number; max: number; minExclusive?: boolean },
): number {
  const typed = readNumber(raw, key, errors);
  if (typed === undefined) return 0;
  const n = roundToHundredths(typed);
  const belowMin = bounds.minExclusive ? n <= bounds.min : n < bounds.min;
  if (belowMin || n > bounds.max) {
    errors[key] = bounds.minExclusive
      ? `Enter a rate above ${bounds.min}% and up to ${bounds.max}%.`
      : `Enter a rate between ${bounds.min}% and ${bounds.max}%.`;
  }
  return n;
}

function readAmount(raw: unknown, key: string, errors: Errors): number {
  const typed = readNumber(raw, key, errors);
  if (typed === undefined) return 0;
  const n = roundToHundredths(typed);
  if (n <= 0) {
    errors[key] = "Enter an amount above $0.";
  } else if (n > AMOUNT_MAX) {
    errors[key] = "That amount is too large.";
  }
  return n;
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

function readFilingStatus(raw: unknown, errors: Errors): FilingStatus | null {
  if (raw === undefined || raw === null) return null;
  if (!isFilingStatus(raw)) {
    errors.filingStatus = "Choose a filing status.";
    return null;
  }
  return raw;
}

function readEmployerMatch(raw: unknown, errors: Errors): EmployerMatch | null {
  if (raw === undefined || raw === null) return null;
  const m = asRecord(raw);
  if (!m) {
    errors.employerMatch = "Invalid employer match.";
    return null;
  }
  return {
    matchPct: readPercent(m.matchPct, "employerMatch.matchPct", errors, {
      min: 0, max: MATCH_PCT_MAX, minExclusive: true,
    }),
    limitPct: readPercent(m.limitPct, "employerMatch.limitPct", errors, {
      min: 0, max: MATCH_LIMIT_MAX, minExclusive: true,
    }),
  };
}

function readLabel(raw: unknown, key: string, errors: Errors): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") {
    errors[key] = "Invalid label.";
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length > LABEL_MAX) errors[key] = `Maximum ${LABEL_MAX} characters.`;
  return trimmed.length === 0 ? null : trimmed;
}

function readIncomeStreams(raw: unknown, errors: Errors): IncomeStream[] {
  if (!Array.isArray(raw)) {
    errors.incomeStreams = "Invalid income list.";
    return [];
  }
  if (raw.length > MAX_INCOME_STREAMS) {
    errors.incomeStreams = `Up to ${MAX_INCOME_STREAMS} income streams.`;
    return [];
  }
  return raw.map((item, i) => {
    const prefix = `incomeStreams.${i}`;
    const s = asRecord(item) ?? {};
    if (!isIncomeKind(s.kind)) errors[`${prefix}.kind`] = "Choose an income type.";
    let frequency: IncomeStream["frequency"] = null;
    if (s.frequency !== undefined && s.frequency !== null) {
      if (isPayFrequency(s.frequency)) frequency = s.frequency;
      else errors[`${prefix}.frequency`] = "Choose a frequency.";
    }
    return {
      kind: s.kind as IncomeStream["kind"],
      label: readLabel(s.label, `${prefix}.label`, errors),
      annualAmount: readAmount(s.annualAmount, `${prefix}.annualAmount`, errors),
      frequency,
    };
  });
}

function readContributionTargets(raw: unknown, errors: Errors): ContributionTarget[] {
  if (!Array.isArray(raw)) {
    errors.contributionTargets = "Invalid contribution list.";
    return [];
  }
  if (raw.length > MAX_CONTRIBUTION_TARGETS) {
    errors.contributionTargets = `Up to ${MAX_CONTRIBUTION_TARGETS} contribution targets.`;
    return [];
  }
  const seen = new Set<string>();
  return raw.map((item, i) => {
    const prefix = `contributionTargets.${i}`;
    const c = asRecord(item) ?? {};
    const accountId = typeof c.accountId === "string" ? c.accountId : "";
    if (accountId === "") {
      errors[`${prefix}.accountId`] = "Choose an account.";
    } else if (seen.has(accountId)) {
      // On the later row, so the one the user just added is the one flagged.
      errors[`${prefix}.accountId`] = "This account already has a target.";
    }
    seen.add(accountId);
    return {
      accountId,
      annualAmount: readAmount(c.annualAmount, `${prefix}.annualAmount`, errors),
    };
  });
}

export function parseFinancialProfileBody(body: unknown): ParseResult<FinancialProfileInput> {
  const b = asRecord(body);
  if (!b) return { ok: false, fieldErrors: {} };
  const errors: Errors = {};

  const value: FinancialProfileInput = {
    age: readAge(b.age, "age", errors),
    // Not cross-checked against `age`: a retirement age already passed is how
    // someone who has retired describes themselves.
    targetRetirementAge: readAge(b.targetRetirementAge, "targetRetirementAge", errors),
    expectedRealReturnPct: readPercent(b.expectedRealReturnPct, "expectedRealReturnPct", errors, {
      min: RETURN_MIN, max: RETURN_MAX,
    }),
    safeWithdrawalRatePct: readPercent(b.safeWithdrawalRatePct, "safeWithdrawalRatePct", errors, {
      min: 0, max: SWR_MAX, minExclusive: true,
    }),
    inflationPct: readPercent(b.inflationPct, "inflationPct", errors, {
      min: INFLATION_MIN, max: INFLATION_MAX,
    }),
    filingStatus: readFilingStatus(b.filingStatus, errors),
    employerMatch: readEmployerMatch(b.employerMatch, errors),
    incomeStreams: readIncomeStreams(b.incomeStreams, errors),
    contributionTargets: readContributionTargets(b.contributionTargets, errors),
  };

  // The match limit is a percent of salary, so without a salary it describes
  // nothing — better to say so than to store a match no calculation can use.
  if (
    value.employerMatch &&
    !errors.employerMatch &&
    !errors.incomeStreams &&
    !value.incomeStreams.some((s) => s.kind === "salary")
  ) {
    errors.employerMatch = "Add a salary income to use an employer match.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, fieldErrors: errors };
  return { ok: true, value };
}
