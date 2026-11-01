// Reduces the financial profile, accounts and transaction history to the one
// FireInputs object the FIRE page hands its client. Pure — no DB, no React.
//
// Income comes from the profile's declared (gross) streams, not from the
// transactions: savings is gross × (1 − tax) − spending, and the tax rate is
// pre-filled from what the transactions show actually landing in the bank. Why
// that and not gross − spending, why interest and dividends are not part of
// gross, and why only some income kinds take part in the derivation, is in
// docs/decisions/0017-fire-savings-from-profile-income.md.
//
// asOf's month and day come from its local calendar fields, and month keys
// ("YYYY-MM") are sliced from transaction dates, never built through a Date —
// see docs/decisions/0010-utc-persistence-local-period-math.md.

import { getBucketForType } from "./account-utils";
import { ageOn, totalAnnualIncome } from "./financial-profile-utils";
import { computeSpendingBaseline, monthFromIndex, monthIndex } from "./fire-spending";
import { roundToCent } from "./money";
import type {
  Account,
  AccountType,
  FinancialProfile,
  FirePageState,
  IncomeKind,
  InvestablePortfolio,
  MonthlyCpi,
  TakeHome,
  Transaction,
} from "./types";

// Accounts a paycheck is split into before it reaches the bank. Money sent to
// these never shows up in take-home, so it has to be added back to compare the
// transactions with declared gross pay.
export const PAYROLL_ACCOUNT_TYPES: AccountType[] = ["401k", "roth_401k", "hsa", "espp"];

// The accounts an employer match is paid into.
export const MATCH_ACCOUNT_TYPES: AccountType[] = ["401k", "roth_401k"];

// Income that reaches checking, so the transactions can be compared with it.
// RSUs arrive as shares, ESPP as a purchase, and interest and dividends stay in
// the account that earned them.
export const CASH_INCOME_KINDS: IncomeKind[] = ["salary", "bonus", "rental", "self_employment", "other"];

// Income the portfolio already earns. It stays in the account that earned it,
// and the simulation's historical returns are total returns, reinvested, so
// counting it as a contribution as well would count it twice.
export const PASSIVE_INCOME_KINDS: IncomeKind[] = ["interest_dividends"];

// Take-home is a run-rate, and a run-rate over a few months is mostly noise
// (one bonus month reads as a yearly pattern), so it needs half a year to count.
const TAKE_HOME_WINDOW_MONTHS = 12;
const TAKE_HOME_MIN_MONTHS = 6;

// A derived rate outside this range means the transactions and the profile
// disagree about something other than tax — a stream missing from the profile,
// or income in the bank that was never declared — so it is not offered.
const DERIVED_TAX_MIN_PCT = 0;
const DERIVED_TAX_MAX_PCT = 60;

/**
 * What retirement can draw on: cash, investment and retirement accounts, minus
 * credit-card debt. Pass active accounts only. Hidden accounts and the
 * `uncategorized` bucket are skipped, as in net worth; a home and its mortgage
 * are left out because a house is lived in, not withdrawn from. A card's
 * balance is what is owed, so a negative one is a credit and adds.
 */
export function computeInvestablePortfolio(accounts: Account[]): InvestablePortfolio {
  let cash = 0;
  let investments = 0;
  let retirement = 0;
  let creditCardDebt = 0;

  for (const account of accounts) {
    if (account.hiddenFromNetWorth) continue;
    switch (getBucketForType(account.type)) {
      case "cash":
        cash += account.balance;
        break;
      case "investments":
        investments += account.balance;
        break;
      case "retirement":
        retirement += account.balance;
        break;
      case "debt":
        // Only cards: they are paid off from the same pocket the portfolio
        // lives in. A mortgage is paid from income and is not part of the pot.
        if (account.type === "credit_card") creditCardDebt += account.balance;
        break;
      default:
        // real_estate and uncategorized.
        break;
    }
  }

  return {
    total: roundToCent(cash + investments + retirement - creditCardDebt),
    cash: roundToCent(cash),
    investments: roundToCent(investments),
    retirement: roundToCent(retirement),
    creditCardDebt: roundToCent(creditCardDebt),
  };
}

/**
 * Annual take-home from income transactions, or null when there isn't enough
 * history to call it a run-rate.
 *
 * The window is the last 12 complete months before `asOf`'s month (the current
 * one is partial), but not before `fromMonth`: the spending baseline's first
 * month, so income and spending describe the same stretch of life. Months with
 * no income count in the average. Fewer than 6 months gives null.
 */
export function computeTakeHome(transactions: Transaction[], asOf: Date, fromMonth: string): TakeHome | null {
  const toIndex = asOf.getFullYear() * 12 + asOf.getMonth() - 1;
  const startIndex = Math.max(toIndex - (TAKE_HOME_WINDOW_MONTHS - 1), monthIndex(fromMonth));
  const months = toIndex - startIndex + 1;
  if (months < TAKE_HOME_MIN_MONTHS) return null;

  const start = monthFromIndex(startIndex);
  const end = monthFromIndex(toIndex);
  let total = 0;
  for (const t of transactions) {
    if (t.type !== "income") continue;
    const month = t.date.slice(0, 7);
    if (month < start || month > end) continue;
    total += t.amount;
  }
  return { annual: roundToCent((total / months) * 12), months };
}

// The profile's contribution targets that point at an account of one of
// `types`. A target whose account isn't in the map contributes nothing, rather
// than being guessed at.
function sumTargets(
  profile: FinancialProfile,
  accountTypes: Map<string, AccountType>,
  types: AccountType[],
): number {
  let total = 0;
  for (const target of profile.contributionTargets) {
    const type = accountTypes.get(target.accountId);
    if (type !== undefined && types.includes(type)) total += target.annualAmount;
  }
  return total;
}

/**
 * Yearly contributions taken from the paycheck before it is deposited. The map
 * must cover active and archived accounts: a target can still name an account
 * archived since the profile was saved.
 */
export function payrollDeductions(profile: FinancialProfile, accountTypes: Map<string, AccountType>): number {
  return roundToCent(sumTargets(profile, accountTypes, PAYROLL_ACCOUNT_TYPES));
}

/**
 * The yearly employer match: `matchPct`% of the user's 401(k) contributions, up
 * to `limitPct`% of salary. The limit is measured against salary only — a match
 * is not paid on a bonus or RSUs unless the plan says so, which the profile
 * has no way to say.
 */
export function employerMatchAmount(profile: FinancialProfile, accountTypes: Map<string, AccountType>): number {
  const match = profile.employerMatch;
  if (!match) return 0;
  const salary = totalAnnualIncome(profile.incomeStreams.filter((s) => s.kind === "salary"));
  const matched = Math.min(sumTargets(profile, accountTypes, MATCH_ACCOUNT_TYPES), (match.limitPct / 100) * salary);
  return roundToCent((match.matchPct / 100) * matched);
}

/**
 * The share of cash income that went to tax, implied by what reached the bank:
 * `1 − (take-home + payroll deductions) / cash income`, as a percent to one
 * decimal. Null when there is no take-home, no cash income to divide by, or a
 * result outside 0 to 60 — which would pre-fill a number the user can't trust.
 */
export function deriveEffectiveTaxRatePct(
  cashIncome: number,
  takeHome: TakeHome | null,
  payroll: number,
): number | null {
  if (takeHome === null || cashIncome <= 0) return null;
  // `|| 0` turns -0 (a rate that rounds to nothing from below) into 0.
  const pct = Math.round((1 - (takeHome.annual + payroll) / cashIncome) * 1000) / 10 || 0;
  return pct < DERIVED_TAX_MIN_PCT || pct > DERIVED_TAX_MAX_PCT ? null : pct;
}

// "YYYY-MM-DD" from local fields: the day the user is standing in, which is
// not necessarily the UTC day toISOString() would report.
function localDateString(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  return `${monthFromIndex(date.getFullYear() * 12 + date.getMonth())}-${day}`;
}

/**
 * Everything the FIRE page needs, or which of its two prerequisites is
 * missing. `accounts` are active; `archivedAccounts` are only consulted for the
 * type of an account a contribution target still points at.
 */
export function buildFireInputs(args: {
  profile: FinancialProfile | null;
  accounts: Account[];
  archivedAccounts: Account[];
  transactions: Transaction[];
  asOf: Date;
  cpi: MonthlyCpi[];
}): FirePageState {
  const { profile, accounts, archivedAccounts, transactions, asOf, cpi } = args;
  if (!profile) return { state: "no-profile" };

  const spending = computeSpendingBaseline(transactions, asOf, cpi, profile.inflationPct);
  if (!spending) return { state: "no-spending" };

  const accountTypes = new Map<string, AccountType>();
  for (const a of archivedAccounts) accountTypes.set(a.id, a.type);
  for (const a of accounts) accountTypes.set(a.id, a.type);

  const isPassive = (kind: IncomeKind) => PASSIVE_INCOME_KINDS.includes(kind);
  const grossIncome = totalAnnualIncome(profile.incomeStreams.filter((s) => !isPassive(s.kind)));
  const excludedPassiveIncome = totalAnnualIncome(profile.incomeStreams.filter((s) => isPassive(s.kind)));
  const cashIncome = totalAnnualIncome(profile.incomeStreams.filter((s) => CASH_INCOME_KINDS.includes(s.kind)));
  const takeHome = computeTakeHome(transactions, asOf, spending.fromMonth);
  const payroll = payrollDeductions(profile, accountTypes);

  return {
    state: "ready",
    inputs: {
      asOf: localDateString(asOf),
      age: ageOn(profile, asOf),
      targetRetirementAge: profile.targetRetirementAge,
      portfolio: computeInvestablePortfolio(accounts),
      spending,
      grossIncome,
      excludedPassiveIncome,
      cashIncome,
      takeHome,
      payrollDeductions: payroll,
      employerMatch: employerMatchAmount(profile, accountTypes),
      derivedTaxRatePct: deriveEffectiveTaxRatePct(cashIncome, takeHome, payroll),
      profileRealReturnPct: profile.expectedRealReturnPct,
      profileInflationPct: profile.inflationPct,
      profileSafeWithdrawalRatePct: profile.safeWithdrawalRatePct,
    },
  };
}
