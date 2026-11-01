import { describe, it, expect } from "vitest";
import {
  CASH_INCOME_KINDS,
  MATCH_ACCOUNT_TYPES,
  PAYROLL_ACCOUNT_TYPES,
  buildFireInputs,
  computeInvestablePortfolio,
  computeTakeHome,
  deriveEffectiveTaxRatePct,
  employerMatchAmount,
  payrollDeductions,
} from "./fire-inputs";
import type {
  Account,
  AccountType,
  FinancialProfile,
  IncomeKind,
  IncomeStream,
  MonthlyCpi,
  TakeHome,
  Transaction,
} from "./types";

// Synthetic fixtures only (public repo): invented accounts and round amounts.

let nextAccountId = 0;
function account(type: AccountType, balance: number, overrides: Partial<Account> = {}): Account {
  nextAccountId += 1;
  return {
    id: `a${nextAccountId}`,
    name: `Account ${nextAccountId}`,
    type,
    institution: null,
    balance,
    balanceAsOf: "2026-10-01T00:00:00.000Z",
    hiddenFromNetWorth: false,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

function stream(kind: IncomeKind, annualAmount: number): IncomeStream {
  return { kind, label: null, annualAmount, frequency: null };
}

function profile(overrides: Partial<FinancialProfile> = {}): FinancialProfile {
  return {
    version: 1,
    effectiveAt: "2026-01-01T00:00:00.000Z",
    anchoredAge: 40,
    ageAnchoredAt: "2024-03-01T00:00:00.000Z",
    targetRetirementAge: 55,
    expectedRealReturnPct: 5,
    safeWithdrawalRatePct: 4,
    inflationPct: 2.5,
    filingStatus: null,
    employerMatch: null,
    incomeStreams: [],
    contributionTargets: [],
    ...overrides,
  };
}

let nextTxId = 0;
function tx(overrides: Partial<Transaction> = {}): Transaction {
  nextTxId += 1;
  return {
    id: `t${nextTxId}`,
    description: "Purchase",
    amount: 100,
    categoryId: "misc",
    type: "expense",
    date: "2026-03-15",
    merchant: null,
    ...overrides,
  };
}

/** One transaction on the 15th of each listed month ("YYYY-MM"). */
function onEach(months: string[], overrides: Partial<Transaction>): Transaction[] {
  return months.map((month) => tx({ ...overrides, date: `${month}-15` }));
}

/** Every month from `from` to `to` inclusive, as "YYYY-MM". */
function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  const last = Number(to.slice(0, 4)) * 12 + Number(to.slice(5, 7));
  while (year * 12 + month <= last) {
    out.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return out;
}

/** A contiguous monthly table at a constant level, so a restatement is a no-op. */
function flatCpi(from: string, to: string): MonthlyCpi[] {
  return monthsBetween(from, to).map((month) => ({ month, cpi: 100 }));
}

function typesOf(...accounts: Account[]): Map<string, AccountType> {
  return new Map(accounts.map((a) => [a.id, a.type]));
}

// Local calendar fields, because period math is local (see decision 0010).
// The window of complete months before this one ends in September 2026.
const OCT_15_2026 = new Date(2026, 9, 15);

describe("account type groups", () => {
  it("names the paycheck, match and cash-income sets", () => {
    expect(PAYROLL_ACCOUNT_TYPES).toEqual(["401k", "roth_401k", "hsa", "espp"]);
    expect(MATCH_ACCOUNT_TYPES).toEqual(["401k", "roth_401k"]);
    expect(CASH_INCOME_KINDS).toEqual(["salary", "bonus", "rental", "self_employment", "other"]);
  });
});

describe("computeInvestablePortfolio", () => {
  it("investable portfolio excludes home, mortgage, hidden and uncategorized", () => {
    const portfolio = computeInvestablePortfolio([
      account("cash", 10_000),
      account("brokerage", 100_000),
      account("401k", 50_000),
      account("property", 500_000),
      account("loan_mortgage", 300_000),
      account("credit_card", 2_000),
      account("brokerage", 40_000, { hiddenFromNetWorth: true }),
      account("uncategorized", 5_000),
      account("credit_card", -500),
    ]);
    expect(portfolio).toEqual({
      total: 158_500,
      cash: 10_000,
      investments: 100_000,
      retirement: 50_000,
      creditCardDebt: 1_500,
    });
  });

  it("sums each bucket across its account types", () => {
    const portfolio = computeInvestablePortfolio([
      account("brokerage", 1_000),
      account("hsa", 2_000),
      account("traditional_ira", 3_000),
      account("roth_401k", 4_000),
      account("cash", 500),
    ]);
    expect(portfolio.investments).toBe(3_000);
    expect(portfolio.retirement).toBe(7_000);
    expect(portfolio.cash).toBe(500);
    expect(portfolio.total).toBe(10_500);
  });

  it("lets a card carrying a net statement credit add to the total", () => {
    const portfolio = computeInvestablePortfolio([account("cash", 1_000), account("credit_card", -300)]);
    expect(portfolio.creditCardDebt).toBe(-300);
    expect(portfolio.total).toBe(1_300);
  });

  it("leaves out a hidden card", () => {
    const portfolio = computeInvestablePortfolio([
      account("cash", 1_000),
      account("credit_card", 400, { hiddenFromNetWorth: true }),
    ]);
    expect(portfolio.creditCardDebt).toBe(0);
    expect(portfolio.total).toBe(1_000);
  });

  it("is all zeros with no accounts", () => {
    expect(computeInvestablePortfolio([])).toEqual({
      total: 0,
      cash: 0,
      investments: 0,
      retirement: 0,
      creditCardDebt: 0,
    });
  });

  it("rounds float dust to the cent", () => {
    const portfolio = computeInvestablePortfolio([account("cash", 0.1), account("cash", 0.2)]);
    expect(portfolio.cash).toBe(0.3);
    expect(portfolio.total).toBe(0.3);
  });
});

describe("employerMatchAmount", () => {
  const k401 = account("401k", 0);

  it("match is capped at the limit", () => {
    const base = {
      incomeStreams: [stream("salary", 150_000)],
      employerMatch: { matchPct: 50, limitPct: 6 },
    };
    // 6% of 150,000 is 9,000, so a 20,000 target is matched on 9,000 only: 50% = 4,500.
    expect(
      employerMatchAmount(
        profile({ ...base, contributionTargets: [{ accountId: k401.id, annualAmount: 20_000 }] }),
        typesOf(k401),
      ),
    ).toBe(4_500);
    // Under the cap the whole contribution is matched: 50% of 5,000.
    expect(
      employerMatchAmount(
        profile({ ...base, contributionTargets: [{ accountId: k401.id, annualAmount: 5_000 }] }),
        typesOf(k401),
      ),
    ).toBe(2_500);
  });

  it("counts a Roth 401(k) target but not a Roth IRA one", () => {
    const base = {
      incomeStreams: [stream("salary", 150_000)],
      employerMatch: { matchPct: 50, limitPct: 6 },
    };
    const roth401k = account("roth_401k", 0);
    const rothIra = account("roth_ira", 0);
    expect(
      employerMatchAmount(
        profile({ ...base, contributionTargets: [{ accountId: roth401k.id, annualAmount: 5_000 }] }),
        typesOf(roth401k),
      ),
    ).toBe(2_500);
    expect(
      employerMatchAmount(
        profile({ ...base, contributionTargets: [{ accountId: rothIra.id, annualAmount: 5_000 }] }),
        typesOf(rothIra),
      ),
    ).toBe(0);
  });

  it("is 0 with no match", () => {
    expect(
      employerMatchAmount(
        profile({
          incomeStreams: [stream("salary", 150_000)],
          employerMatch: null,
          contributionTargets: [{ accountId: k401.id, annualAmount: 20_000 }],
        }),
        typesOf(k401),
      ),
    ).toBe(0);
  });

  it("measures the limit against salary only, not bonus or RSUs", () => {
    // 6% of 100,000 salary is 6,000; a limit read off the 250,000 total would be 15,000.
    expect(
      employerMatchAmount(
        profile({
          incomeStreams: [stream("salary", 100_000), stream("bonus", 50_000), stream("rsu", 100_000)],
          employerMatch: { matchPct: 100, limitPct: 6 },
          contributionTargets: [{ accountId: k401.id, annualAmount: 20_000 }],
        }),
        typesOf(k401),
      ),
    ).toBe(6_000);
  });

  it("matches an archived 401(k) target, since its type comes from the map", () => {
    const archived = account("401k", 0);
    expect(
      employerMatchAmount(
        profile({
          incomeStreams: [stream("salary", 100_000)],
          employerMatch: { matchPct: 50, limitPct: 6 },
          contributionTargets: [{ accountId: archived.id, annualAmount: 4_000 }],
        }),
        typesOf(archived),
      ),
    ).toBe(2_000);
  });
});

describe("payrollDeductions", () => {
  it("payroll deductions count only paycheck accounts", () => {
    const k401 = account("401k", 0);
    const hsa = account("hsa", 0);
    const rothIra = account("roth_ira", 0);
    expect(
      payrollDeductions(
        profile({
          contributionTargets: [
            { accountId: k401.id, annualAmount: 20_000 },
            { accountId: hsa.id, annualAmount: 4_000 },
            { accountId: rothIra.id, annualAmount: 7_000 },
          ],
        }),
        typesOf(k401, hsa, rothIra),
      ),
    ).toBe(24_000);
  });

  it("still counts a target on an archived 401(k)", () => {
    const archived = account("401k", 0);
    const active = account("hsa", 0);
    expect(
      payrollDeductions(
        profile({
          contributionTargets: [
            { accountId: archived.id, annualAmount: 20_000 },
            { accountId: active.id, annualAmount: 4_000 },
          ],
        }),
        // buildFireInputs fills this from active and archived accounts together.
        typesOf(archived, active),
      ),
    ).toBe(24_000);
  });

  it("ignores a target whose account is in neither list", () => {
    expect(
      payrollDeductions(profile({ contributionTargets: [{ accountId: "gone", annualAmount: 5_000 }] }), new Map()),
    ).toBe(0);
  });
});

describe("deriveEffectiveTaxRatePct", () => {
  const takeHome = (annual: number): TakeHome => ({ annual, months: 12 });

  it("derives the effective tax rate from cash income", () => {
    // 1 - (90,000 + 24,000) / 150,000 = 24%.
    expect(deriveEffectiveTaxRatePct(150_000, takeHome(90_000), 24_000)).toBe(24);
  });

  it("rounds to one decimal place", () => {
    // 1 - 93,333 / 150,000 = 37.778%.
    expect(deriveEffectiveTaxRatePct(150_000, takeHome(93_333), 0)).toBe(37.8);
  });

  it("is null with no take-home", () => {
    expect(deriveEffectiveTaxRatePct(150_000, null, 24_000)).toBeNull();
  });

  it("is null with no cash income to compare against", () => {
    expect(deriveEffectiveTaxRatePct(0, takeHome(90_000), 0)).toBeNull();
    expect(deriveEffectiveTaxRatePct(-1, takeHome(90_000), 0)).toBeNull();
  });

  it("is null when the result is implausibly high", () => {
    // 1 - 25,000 / 100,000 = 75%.
    expect(deriveEffectiveTaxRatePct(100_000, takeHome(25_000), 0)).toBeNull();
  });

  it("is null when take-home exceeds cash income", () => {
    // 1 - 120,000 / 100,000 = -20%.
    expect(deriveEffectiveTaxRatePct(100_000, takeHome(120_000), 0)).toBeNull();
  });

  it("keeps the edges of the plausible range", () => {
    expect(deriveEffectiveTaxRatePct(100_000, takeHome(40_000), 0)).toBe(60);
    expect(deriveEffectiveTaxRatePct(100_000, takeHome(100_000), 0)).toBe(0);
    // A hair above 60 rounds to 60.0, which is inside the range.
    expect(deriveEffectiveTaxRatePct(100_000, takeHome(39_960), 0)).toBe(60);
  });
});

describe("computeTakeHome", () => {
  const LONG_AGO = "2020-01";

  it("take-home annualizes a short history and refuses a very short one", () => {
    // Twelve complete months before October 2026: October 2025 to September 2026.
    const twelve = onEach(monthsBetween("2025-10", "2026-09"), { type: "income", amount: 6_000 });
    expect(computeTakeHome(twelve, OCT_15_2026, LONG_AGO)).toEqual({ annual: 72_000, months: 12 });

    // History that starts in February: eight months, $5,000 each, so 40,000 / 8 * 12.
    const eight = onEach(monthsBetween("2026-02", "2026-09"), { type: "income", amount: 5_000 });
    expect(computeTakeHome(eight, OCT_15_2026, "2026-02")).toEqual({ annual: 60_000, months: 8 });

    // Four months is too little to call a run-rate.
    const four = onEach(monthsBetween("2026-06", "2026-09"), { type: "income", amount: 5_000 });
    expect(computeTakeHome(four, OCT_15_2026, "2026-06")).toBeNull();
  });

  it("accepts exactly six months", () => {
    const six = onEach(monthsBetween("2026-04", "2026-09"), { type: "income", amount: 5_000 });
    expect(computeTakeHome(six, OCT_15_2026, "2026-04")).toEqual({ annual: 60_000, months: 6 });
  });

  it("counts months with no income in the average", () => {
    // Only six of the twelve months have a paycheck: 6 * 6,000 / 12 * 12 = 36,000.
    const sparse = onEach(monthsBetween("2026-04", "2026-09"), { type: "income", amount: 6_000 });
    expect(computeTakeHome(sparse, OCT_15_2026, LONG_AGO)).toEqual({ annual: 36_000, months: 12 });
  });

  it("leaves out the current month, anything older than twelve months, and anything before fromMonth", () => {
    const window = [
      ...onEach(monthsBetween("2025-10", "2025-12"), { type: "income", amount: 12_000 }),
      ...onEach(monthsBetween("2026-01", "2026-09"), { type: "income", amount: 6_000 }),
    ];
    const outside = [
      tx({ type: "income", amount: 99_000, date: "2026-10-01" }), // the current, partial month
      tx({ type: "income", amount: 99_000, date: "2025-09-30" }), // the thirteenth month back
    ];
    // 3 * 12,000 + 9 * 6,000 = 90,000 over twelve months.
    expect(computeTakeHome([...window, ...outside], OCT_15_2026, LONG_AGO)).toEqual({ annual: 90_000, months: 12 });

    // A fromMonth of 2026-01 shortens the window to nine months and drops the larger early paychecks.
    expect(computeTakeHome([...window, ...outside], OCT_15_2026, "2026-01")).toEqual({
      annual: 72_000,
      months: 9,
    });
  });

  it("counts only income transactions", () => {
    const months = monthsBetween("2025-10", "2026-09");
    const mixed = [
      ...onEach(months, { type: "income", amount: 6_000 }),
      ...onEach(months, { type: "expense", amount: 3_000 }),
      ...onEach(months, { type: "transfer", amount: 8_000 }),
    ];
    expect(computeTakeHome(mixed, OCT_15_2026, LONG_AGO)).toEqual({ annual: 72_000, months: 12 });
  });

  it("is null when fromMonth is not before the current month", () => {
    expect(computeTakeHome([], OCT_15_2026, "2026-10")).toBeNull();
    expect(computeTakeHome([], OCT_15_2026, "2027-01")).toBeNull();
  });

  it("is a rounded zero with no income at all over a long enough window", () => {
    expect(computeTakeHome([], OCT_15_2026, LONG_AGO)).toEqual({ annual: 0, months: 12 });
  });
});

describe("buildFireInputs", () => {
  const cpi = flatCpi("2024-01", "2026-10");
  // Rent on the 15th from January 2025: the earliest month is dropped as a
  // possible part-month, so the baseline averages February 2025 to September 2026.
  const rent = onEach(monthsBetween("2025-01", "2026-10"), {
    type: "expense",
    amount: 2_000,
    merchant: "Landlord",
    description: "Rent",
  });
  const paychecks = onEach(monthsBetween("2025-01", "2026-10"), { type: "income", amount: 6_000 });

  function args(overrides: Partial<Parameters<typeof buildFireInputs>[0]> = {}) {
    return {
      profile: profile({ incomeStreams: [stream("salary", 150_000)] }),
      accounts: [] as Account[],
      archivedAccounts: [] as Account[],
      transactions: [...rent, ...paychecks],
      asOf: OCT_15_2026,
      cpi,
      ...overrides,
    };
  }

  it("buildFireInputs reports what's missing", () => {
    expect(buildFireInputs(args({ profile: null }))).toEqual({ state: "no-profile" });
    // A profile but nothing spent: there is no baseline to build a FIRE number on.
    expect(buildFireInputs(args({ transactions: paychecks }))).toEqual({ state: "no-spending" });
    expect(buildFireInputs(args({ transactions: [] }))).toEqual({ state: "no-spending" });
  });

  it("checks for the profile before the spending", () => {
    expect(buildFireInputs(args({ profile: null, transactions: [] }))).toEqual({ state: "no-profile" });
  });

  it("is no-spending when the history has no complete month yet", () => {
    const thisMonthOnly = [tx({ type: "expense", amount: 50, date: "2026-10-03" })];
    expect(buildFireInputs(args({ transactions: thisMonthOnly }))).toEqual({ state: "no-spending" });
  });

  it("buildFireInputs excludes RSU income from cash income", () => {
    const result = buildFireInputs(
      args({ profile: profile({ incomeStreams: [stream("salary", 150_000), stream("rsu", 50_000)] }) }),
    );
    if (result.state !== "ready") throw new Error(`expected ready, got ${result.state}`);
    expect(result.inputs.grossIncome).toBe(200_000);
    expect(result.inputs.cashIncome).toBe(150_000);
  });

  it("leaves interest and ESPP out of cash income too, and keeps bonus, rental, self-employment and other", () => {
    const result = buildFireInputs(
      args({
        profile: profile({
          incomeStreams: [
            stream("salary", 100_000),
            stream("bonus", 10_000),
            stream("rental", 12_000),
            stream("self_employment", 8_000),
            stream("other", 1_000),
            stream("espp", 5_000),
            stream("interest_dividends", 3_000),
            stream("rsu", 40_000),
          ],
        }),
      }),
    );
    if (result.state !== "ready") throw new Error(`expected ready, got ${result.state}`);
    expect(result.inputs.grossIncome).toBe(179_000);
    expect(result.inputs.cashIncome).toBe(131_000);
  });

  it("assembles every input from one profile, its accounts and the history", () => {
    const k401 = account("401k", 50_000);
    const hsa = account("hsa", 6_000);
    const archived401k = account("roth_401k", 0);
    const cash = account("cash", 20_000);
    const card = account("credit_card", 1_000);
    const result = buildFireInputs(
      args({
        profile: profile({
          targetRetirementAge: 52,
          expectedRealReturnPct: 4.5,
          safeWithdrawalRatePct: 3.5,
          inflationPct: 2.5,
          employerMatch: { matchPct: 50, limitPct: 6 },
          incomeStreams: [stream("salary", 150_000), stream("rsu", 50_000)],
          contributionTargets: [
            { accountId: k401.id, annualAmount: 16_000 },
            { accountId: hsa.id, annualAmount: 4_000 },
            { accountId: archived401k.id, annualAmount: 4_000 },
          ],
        }),
        accounts: [k401, hsa, cash, card],
        archivedAccounts: [archived401k],
      }),
    );
    if (result.state !== "ready") throw new Error(`expected ready, got ${result.state}`);
    const { inputs } = result;

    expect(inputs.asOf).toBe("2026-10-15");
    // Anchored at 40 in March 2024; the anniversary has passed twice by October 2026.
    expect(inputs.age).toBe(42);
    expect(inputs.targetRetirementAge).toBe(52);
    expect(inputs.portfolio).toEqual({
      total: 75_000,
      cash: 20_000,
      investments: 6_000,
      retirement: 50_000,
      creditCardDebt: 1_000,
    });
    expect(inputs.spending.annualSpending).toBe(24_000);
    expect(inputs.spending.fromMonth).toBe("2025-02");
    expect(inputs.spending.toMonth).toBe("2026-09");
    expect(inputs.grossIncome).toBe(200_000);
    expect(inputs.cashIncome).toBe(150_000);
    expect(inputs.takeHome).toEqual({ annual: 72_000, months: 12 });
    // Paycheck accounts: 401k 16,000 + HSA 4,000 + the archived Roth 401(k) 4,000.
    expect(inputs.payrollDeductions).toBe(24_000);
    // Match accounts: 401k 16,000 + roth_401k 4,000 = 20,000; the cap is 6% of 150,000 = 9,000; 50% of 9,000.
    expect(inputs.employerMatch).toBe(4_500);
    // 1 - (72,000 + 24,000) / 150,000 = 36%.
    expect(inputs.derivedTaxRatePct).toBe(36);
    expect(inputs.profileRealReturnPct).toBe(4.5);
    expect(inputs.profileInflationPct).toBe(2.5);
    expect(inputs.profileSafeWithdrawalRatePct).toBe(3.5);
  });

  it("takes the take-home window from the spending baseline's first month", () => {
    // The history starts in January 2026, so the baseline's first month is
    // 2026-02 and take-home averages February to September, not a full twelve.
    const shortHistory = [
      ...onEach(monthsBetween("2026-01", "2026-10"), { type: "expense", amount: 1_000 }),
      ...onEach(monthsBetween("2026-01", "2026-10"), { type: "income", amount: 5_000 }),
    ];
    const result = buildFireInputs(args({ transactions: shortHistory }));
    if (result.state !== "ready") throw new Error(`expected ready, got ${result.state}`);
    expect(result.inputs.spending.fromMonth).toBe("2026-02");
    expect(result.inputs.takeHome).toEqual({ annual: 60_000, months: 8 });
  });

  it("has no take-home, and so no derived tax, when the history is too short", () => {
    const shortHistory = [
      ...onEach(monthsBetween("2026-06", "2026-10"), { type: "expense", amount: 1_000 }),
      ...onEach(monthsBetween("2026-06", "2026-10"), { type: "income", amount: 5_000 }),
    ];
    const result = buildFireInputs(args({ transactions: shortHistory }));
    if (result.state !== "ready") throw new Error(`expected ready, got ${result.state}`);
    expect(result.inputs.takeHome).toBeNull();
    expect(result.inputs.derivedTaxRatePct).toBeNull();
  });

  it("serializes asOf from local fields, zero-padded", () => {
    const january = new Date(2026, 0, 5);
    const result = buildFireInputs(
      args({
        asOf: january,
        transactions: onEach(monthsBetween("2024-01", "2025-12"), { type: "expense", amount: 1_000 }),
      }),
    );
    if (result.state !== "ready") throw new Error(`expected ready, got ${result.state}`);
    expect(result.inputs.asOf).toBe("2026-01-05");
  });

  it("hands the profile's inflation assumption to the spending baseline", () => {
    // The table ends in 2025-12 and the window runs to 2026-09, so the restatement
    // of every month before it depends on the profile's rate. Two rates, two answers.
    const shortCpi = flatCpi("2024-01", "2025-12");
    const at = (inflationPct: number) => {
      const result = buildFireInputs(args({ cpi: shortCpi, profile: profile({ inflationPct, incomeStreams: [] }) }));
      if (result.state !== "ready") throw new Error(`expected ready, got ${result.state}`);
      return result.inputs.spending.annualSpending;
    };
    expect(at(6)).toBeGreaterThan(at(0));
  });
});
