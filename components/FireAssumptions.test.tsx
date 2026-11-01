import { describe, it, expect } from "vitest";
import { render, within } from "@testing-library/react";
import FireAssumptions from "./FireAssumptions";
import { defaultLevers, fiNumber, type ReadyLevers } from "@/lib/fire-levers";
import { formatUsd } from "@/lib/money";
import { MARKET_HISTORY_SOURCE } from "@/lib/market-history-data";
import type { FireInputs, FireLevers } from "@/lib/types";

// Synthetic round numbers only (CLAUDE.md: real figures never appear in source).
function makeInputs(overrides: Partial<FireInputs> = {}): FireInputs {
  return {
    asOf: "2026-06-15",
    age: 35,
    targetRetirementAge: 55,
    portfolio: { total: 248_000, cash: 30_000, investments: 120_000, retirement: 100_000, creditCardDebt: 2_000 },
    spending: {
      annualSpending: 52_800,
      regularAnnual: 48_000,
      amortizedAnnual: 4_800,
      months: 18,
      fromMonth: "2025-01",
      toMonth: "2026-05",
      cpiThrough: "2026-04",
      amortized: [
        { date: "2025-03-10", description: "Synthetic kitchen remodel", amount: 30_000, realAmount: 30_000, annualized: 3_000 },
        { date: "2025-09-02", description: "Synthetic used car", amount: 18_000, realAmount: 18_000, annualized: 1_800 },
      ],
    },
    grossIncome: 150_000,
    excludedPassiveIncome: 0,
    cashIncome: 120_000,
    takeHome: { annual: 78_000, months: 12 },
    payrollDeductions: 18_000,
    employerMatch: 4_500,
    derivedTaxRatePct: 20,
    profileRealReturnPct: 5,
    profileInflationPct: 2,
    profileSafeWithdrawalRatePct: 4,
    ...overrides,
  };
}

const HISTORY = { windowCount: 87, firstStartYear: 1871, lastStartYear: 1957, horizon: 40 };

// Levers start at the defaults; a default with no tax rate (nothing derived)
// gets a typed one, as the page would hold once the user entered it.
function ready(defaults: FireLevers, overrides: Partial<ReadyLevers>): ReadyLevers {
  return { ...defaults, effectiveTaxRatePct: defaults.effectiveTaxRatePct ?? 25, ...overrides };
}

function setup(opts: { inputs?: FireInputs; levers?: Partial<ReadyLevers> } = {}) {
  const inputs = opts.inputs ?? makeInputs();
  const defaults = defaultLevers(inputs);
  const levers = ready(defaults, opts.levers ?? {});
  const utils = render(<FireAssumptions inputs={inputs} levers={levers} defaults={defaults} history={HISTORY} />);
  const rowEl = (name: string): HTMLElement => {
    const el = utils.container.querySelector<HTMLElement>(`[data-row="${name}"]`);
    if (!el) throw new Error(`no row ${name}`);
    return el;
  };
  const row = (name: string) => within(rowEl(name));
  return { inputs, defaults, levers, row, rowEl, ...utils };
}

describe("FireAssumptions", () => {
  it("shows each source", () => {
    const { levers, row } = setup();

    const portfolio = row("portfolio");
    expect(portfolio.getByText(formatUsd(248_000))).toBeInTheDocument();
    expect(portfolio.getByText(formatUsd(30_000))).toBeInTheDocument();
    expect(portfolio.getByText(formatUsd(120_000))).toBeInTheDocument();
    expect(portfolio.getByText(formatUsd(100_000))).toBeInTheDocument();
    expect(portfolio.getByText(formatUsd(2_000))).toBeInTheDocument();
    expect(
      portfolio.getByText("Excludes your home, mortgage, hidden, archived and uncategorized accounts"),
    ).toBeInTheDocument();

    const spending = row("spending");
    expect(spending.getByText(formatUsd(52_800))).toBeInTheDocument();
    expect(
      spending.getByText(
        "18 months of history (2025-01 – 2026-05), in today's dollars (CPI through 2026-04, then 2%/yr)",
      ),
    ).toBeInTheDocument();
    expect(spending.getByText(formatUsd(48_000))).toBeInTheDocument();
    expect(spending.getByText(formatUsd(4_800))).toBeInTheDocument();

    expect(row("income").getByText(formatUsd(150_000))).toBeInTheDocument();

    expect(row("withdrawal").getByText(formatUsd(fiNumber(levers)))).toBeInTheDocument();
    expect(fiNumber(levers)).toBe(1_320_000);
  });

  it("says interest and dividends were left out of income, and why", () => {
    const { row } = setup({ inputs: makeInputs({ excludedPassiveIncome: 3_000 }) });
    expect(
      row("income").getByText(
        `Interest & dividends ${formatUsd(3_000)} left out: the historical returns already reinvest them`,
      ),
    ).toBeInTheDocument();
  });

  it("says nothing about interest and dividends when there are none", () => {
    expect(setup().row("income").queryByText(/Interest & dividends/)).not.toBeInTheDocument();
  });

  it("shows the ages from the Financial Profile", () => {
    const { row } = setup();
    expect(row("age").getByText("35")).toBeInTheDocument();
    expect(row("age").getByText("55")).toBeInTheDocument();
    expect(row("age").getByText(/Financial Profile/)).toBeInTheDocument();
  });

  it("lists each amortized purchase with its annualized amount", () => {
    const { row } = setup();
    const spending = row("spending");
    expect(spending.getByText("2 large one-off purchases smoothed over 10 years")).toBeInTheDocument();
    const items = spending.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("2025-03-10");
    expect(items[0]).toHaveTextContent("Synthetic kitchen remodel");
    expect(items[0]).toHaveTextContent(formatUsd(30_000));
    expect(items[0]).toHaveTextContent(`${formatUsd(3_000)}/yr`);
    expect(items[1]).toHaveTextContent("Synthetic used car");
    expect(items[1]).toHaveTextContent(`${formatUsd(1_800)}/yr`);
  });

  it("omits the purchases disclosure when nothing was smoothed", () => {
    const base = makeInputs();
    const { rowEl } = setup({
      inputs: { ...base, spending: { ...base.spending, amortized: [], amortizedAnnual: 0, regularAnnual: 52_800 } },
    });
    expect(rowEl("spending").querySelector("details")).toBeNull();
  });

  it("states the life the baseline used when the history is longer than ten years", () => {
    // 150 months is 12.5 years, and computeSpendingBaseline spreads each
    // purchase over that, so a label of "10 years" would not match the list.
    const base = makeInputs();
    const { row } = setup({ inputs: { ...base, spending: { ...base.spending, months: 150 } } });
    expect(row("spending").getByText("2 large one-off purchases smoothed over 12.5 years")).toBeInTheDocument();
  });

  it("uses the singular for a single purchase", () => {
    const base = makeInputs();
    const { row } = setup({
      inputs: { ...base, spending: { ...base.spending, amortized: [base.spending.amortized[0]] } },
    });
    expect(row("spending").getByText("1 large one-off purchase smoothed over 10 years")).toBeInTheDocument();
  });

  it("shows how the tax rate was estimated when it is the estimate", () => {
    const { row } = setup();
    const income = row("income");
    expect(income.getByText("20%")).toBeInTheDocument();
    expect(
      income.getByText(
        `Estimated from your data: take-home ${formatUsd(78_000)}/yr (annualized from 12 months) + paycheck deductions ${formatUsd(18_000)}, against cash income ${formatUsd(120_000)}`,
      ),
    ).toBeInTheDocument();
    expect(income.queryByText(/adjusted by you/)).not.toBeInTheDocument();
  });

  it("says the take-home is annualized when it was measured over part of a year", () => {
    // computeTakeHome allows 6 to 11 months; its figure is a yearly run-rate,
    // not what landed in the bank over those months.
    const { row } = setup({ inputs: makeInputs({ takeHome: { annual: 78_000, months: 8 } }) });
    expect(
      row("income").getByText(
        `Estimated from your data: take-home ${formatUsd(78_000)}/yr (annualized from 8 months) + paycheck deductions ${formatUsd(18_000)}, against cash income ${formatUsd(120_000)}`,
      ),
    ).toBeInTheDocument();
    expect(row("income").queryByText(/over 8 months/)).not.toBeInTheDocument();
  });

  it("says when the tax rate was entered rather than derived", () => {
    const { row, rowEl } = setup({
      inputs: makeInputs({ derivedTaxRatePct: null }),
      levers: { effectiveTaxRatePct: 25 },
    });
    expect(row("income").getByText("25%")).toBeInTheDocument();
    expect(row("income").getByText("entered by you")).toBeInTheDocument();
    expect(row("income").queryByText(/Estimated from your data/)).not.toBeInTheDocument();
    // There was no estimate to move off, so this is not an adjustment.
    expect(rowEl("income")).toHaveAttribute("data-adjusted", "false");
    expect(rowEl("savings")).toHaveAttribute("data-adjusted", "false");
  });

  it("says there are no income transactions instead of showing a take-home", () => {
    // computeTakeHome is null, never a $0 run-rate, when nothing came in.
    const { row } = setup({
      inputs: makeInputs({ derivedTaxRatePct: null, takeHome: null }),
      levers: { effectiveTaxRatePct: 25 },
    });
    expect(row("income").getByText(/No income transactions in the last 12 months/)).toBeInTheDocument();
    expect(row("income").queryByText(/take-home/)).not.toBeInTheDocument();
  });

  it("flags a tax rate moved off the estimate and says what the estimate was", () => {
    const { row, rowEl } = setup({ levers: { effectiveTaxRatePct: 30 } });
    expect(row("income").getByText("30%")).toBeInTheDocument();
    expect(row("income").getByText("adjusted by you (estimate was 20%)")).toBeInTheDocument();
    expect(row("income").queryByText(/Estimated from your data/)).not.toBeInTheDocument();
    expect(rowEl("income")).toHaveAttribute("data-adjusted", "true");
  });

  it("marks only the rows whose lever differs from its default", () => {
    const { rowEl } = setup({ levers: { safeWithdrawalRatePct: 3 } });
    expect(rowEl("withdrawal")).toHaveAttribute("data-adjusted", "true");
    for (const untouched of [
      "age",
      "portfolio",
      "spending",
      "income",
      "match",
      "savings",
      "return",
      "allocation",
      "history",
      "not-modeled",
    ]) {
      expect(rowEl(untouched)).toHaveAttribute("data-adjusted", "false");
    }
  });

  it("marks the return row when either side of it moves", () => {
    expect(setup({ levers: { nominalReturnPct: 9 } }).rowEl("return")).toHaveAttribute("data-adjusted", "true");
    expect(setup({ levers: { inflationPct: 3 } }).rowEl("return")).toHaveAttribute("data-adjusted", "true");
  });

  it("marks the allocation row", () => {
    expect(setup({ levers: { stockAllocationPct: 60 } }).rowEl("allocation")).toHaveAttribute(
      "data-adjusted",
      "true",
    );
  });

  it("shows the spending in use and what was measured when it is adjusted", () => {
    const { row, rowEl } = setup({ levers: { annualSpending: 40_000 } });
    expect(rowEl("spending")).toHaveAttribute("data-adjusted", "true");
    expect(row("spending").getByText(formatUsd(40_000))).toBeInTheDocument();
    expect(row("spending").getByText(`adjusted by you (measured ${formatUsd(52_800)})`)).toBeInTheDocument();
  });

  it("moves the savings row when spending does", () => {
    expect(setup({ levers: { annualSpending: 40_000 } }).rowEl("savings")).toHaveAttribute("data-adjusted", "true");
  });

  it("flags nothing as adjusted at the defaults", () => {
    const { container } = setup();
    expect(container.querySelectorAll('[data-adjusted="true"]')).toHaveLength(0);
    expect(container.textContent).not.toMatch(/adjusted by you/);
  });

  it("shows the employer match, or says there is none", () => {
    expect(setup().row("match").getByText(`${formatUsd(4_500)}/yr`)).toBeInTheDocument();
    // Zero also covers a match with no 401(k) target to apply it to, so the copy
    // cannot claim the profile has no match.
    expect(
      setup({ inputs: makeInputs({ employerMatch: 0 }) }).row("match").getByText(
        "None counted — needs an employer match and a 401(k) contribution target in your Financial Profile",
      ),
    ).toBeInTheDocument();
  });

  it("shows the savings rate and the yearly contribution", () => {
    // 150,000 at 20% tax is 120,000 after tax; minus 52,800 spending is 67,200
    // (56%), plus the 4,500 match.
    const { row } = setup();
    expect(row("savings").getByText("56%")).toBeInTheDocument();
    expect(row("savings").getByText(`${formatUsd(71_700)}/yr`)).toBeInTheDocument();
  });

  it("says there is no savings rate without income", () => {
    const { row } = setup({ inputs: makeInputs({ grossIncome: 0, cashIncome: 0 }) });
    expect(row("savings").getByText("No income in your Financial Profile")).toBeInTheDocument();
  });

  it("says the tax rate does not apply without income", () => {
    const { row, rowEl } = setup({
      inputs: makeInputs({ grossIncome: 0, cashIncome: 0, takeHome: null, derivedTaxRatePct: null }),
    });
    expect(row("income").getByText("not applicable — no income in your Financial Profile")).toBeInTheDocument();
    expect(row("income").queryByText("0%")).not.toBeInTheDocument();
    expect(row("income").queryByText(/entered by you|No income transactions/)).not.toBeInTheDocument();
    expect(rowEl("income")).toHaveAttribute("data-adjusted", "false");
  });

  it("shows nominal, inflation and the resulting real return", () => {
    // The defaults reproduce the profile's 5% real at 2% inflation: 7.1% nominal.
    const ret = setup().row("return");
    expect(ret.getByText("7.1% nominal")).toBeInTheDocument();
    expect(ret.getByText("2% inflation")).toBeInTheDocument();
    expect(ret.getByText("5% real")).toBeInTheDocument();
  });

  it("shows the allocation", () => {
    expect(
      setup({ levers: { stockAllocationPct: 80 } }).row("allocation").getByText("80% stocks, 20% bonds"),
    ).toBeInTheDocument();
  });

  it("describes the history it replays and credits the source", () => {
    const history = setup().row("history");
    expect(
      history.getByText("Shiller, 1871–1957 starts, 87 windows of 40 years, recentred to your real return"),
    ).toBeInTheDocument();
    expect(history.getByRole("link", { name: MARKET_HISTORY_SOURCE.name })).toHaveAttribute(
      "href",
      MARKET_HISTORY_SOURCE.url,
    );
  });

  it("lists what is not modeled", () => {
    const notModeled = setup().row("not-modeled");
    for (const item of [
      "Taxes on withdrawals",
      "Social Security and pensions",
      "Fund fees",
      "Contributions rising with raises",
      "The withdrawal phase (roadmap #6)",
    ]) {
      expect(notModeled.getByText(item)).toBeInTheDocument();
    }
  });
});
