import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import FireCalculatorClient from "./FireCalculatorClient";
import { defaultLevers, realReturn, coastFiNumber } from "@/lib/fire-levers";
import { simulateWindows } from "@/lib/fire-simulation";
import { formatUsd } from "@/lib/money";
import type { FireInputs, FirePageState } from "@/lib/types";

// The real simulation, wrapped so a test can count how often it runs.
vi.mock("@/lib/fire-simulation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/fire-simulation")>();
  return { ...actual, simulateWindows: vi.fn(actual.simulateWindows) };
});

// Synthetic round numbers only (CLAUDE.md: real balances never appear in
// source, tests or commits).
function makeInputs(overrides: Partial<FireInputs> = {}): FireInputs {
  return {
    asOf: "2026-01-15",
    age: 35,
    targetRetirementAge: 50,
    portfolio: { total: 300_000, cash: 20_000, investments: 180_000, retirement: 100_000, creditCardDebt: 0 },
    spending: {
      annualSpending: 48_000,
      regularAnnual: 48_000,
      amortizedAnnual: 0,
      months: 24,
      fromMonth: "2024-01",
      toMonth: "2025-12",
      cpiThrough: "2025-09",
      amortized: [],
    },
    grossIncome: 150_000,
    excludedPassiveIncome: 0,
    cashIncome: 150_000,
    takeHome: { annual: 90_000, months: 12 },
    payrollDeductions: 22_500,
    employerMatch: 4_500,
    derivedTaxRatePct: 25,
    profileRealReturnPct: 5,
    profileInflationPct: 3,
    profileSafeWithdrawalRatePct: 4,
    ...overrides,
  };
}

function renderReady(overrides: Partial<FireInputs> = {}) {
  const inputs = makeInputs(overrides);
  return { inputs, ...render(<FireCalculatorClient page={{ state: "ready", inputs }} />) };
}

// The headline cards are named regions, so a figure is looked up inside its
// card: the assumptions panel prints the FI number again further down.
function headline(name: string) {
  return within(screen.getByRole("region", { name }));
}

// Headline figures are whole dollars, so a seven-figure number fits its card;
// the assumptions panel keeps the cents.
function whole(value: number): string {
  return formatUsd(value, { wholeDollars: true });
}

function sliderWrapper(label: string): HTMLElement {
  const wrapper = screen.getByLabelText(label).closest("[data-modified]");
  if (!(wrapper instanceof HTMLElement)) throw new Error(`No slider wrapper for ${label}`);
  return wrapper;
}

function modifiedSliders(container: HTMLElement): Element[] {
  return Array.from(container.querySelectorAll('[data-modified="true"]'));
}

describe("FireCalculatorClient", () => {
  it("pre-fills from the inputs", () => {
    renderReady();
    expect(headline("FI number").getByText(whole(1_200_000))).toBeInTheDocument();
    expect(screen.getByLabelText("Safe withdrawal rate")).toHaveValue("4");
    expect(screen.getByLabelText("Effective tax rate")).toHaveValue("25");
    expect(screen.getByLabelText("Stock allocation")).toHaveValue("100");
  });

  it("shows the portfolio against the FI number, and the neutral years to FI", () => {
    renderReady();
    const portfolio = headline("Investable portfolio");
    expect(portfolio.getByText(whole(300_000))).toBeInTheDocument();
    expect(portfolio.getByText(/25% of your FI number/)).toBeInTheDocument();

    // The neutral scenario's own figure depends on the market history, so the
    // test pins its shape rather than a value.
    const years = headline("Years to FI");
    expect(years.getByText(/^(\d+ yrs? \d+ mos?|Now)$/)).toBeInTheDocument();
    expect(years.getByText(/FI at age \d+/)).toBeInTheDocument();
  });

  it("shows the Coast FI number and whether it is reached now", () => {
    const { inputs } = renderReady();
    const coast = coastFiNumber(1_200_000, realReturn(defaultLevers(inputs)), 15);
    expect(coast).not.toBeNull();
    const card = headline("Coast FI number");
    expect(card.getByText(whole(coast as number))).toBeInTheDocument();
    // 300,000 is below it
    expect(card.getByText("Not reached yet")).toBeInTheDocument();
    // The note describes the number; the line above is the status.
    expect(
      card.getByText(
        "The amount that would grow to your FI number by 50 with no more saving, at your assumed return",
      ),
    ).toBeInTheDocument();
  });

  it("says Coast FI is reached once the portfolio covers it", () => {
    renderReady({ portfolio: { total: 900_000, cash: 0, investments: 900_000, retirement: 0, creditCardDebt: 0 } });
    expect(headline("Coast FI number").getByText("Reached now")).toBeInTheDocument();
  });

  it("says Coast FI no longer applies past the target age", () => {
    renderReady({ age: 52, targetRetirementAge: 50 });
    expect(headline("Coast FI number").getByText("Past your target age")).toBeInTheDocument();
  });

  it("states that the projection is in today's dollars", () => {
    renderReady();
    expect(screen.getByText("In today's dollars")).toBeInTheDocument();
  });

  it("withdrawal-rate slider changes the FI number", () => {
    const { container } = renderReady();
    expect(modifiedSliders(container)).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("Safe withdrawal rate"), { target: { value: "3" } });

    expect(headline("FI number").getByText(whole(1_600_000))).toBeInTheDocument();
    expect(sliderWrapper("Safe withdrawal rate")).toHaveAttribute("data-modified", "true");
    // One element per modified slider, so one moved lever is one match.
    expect(modifiedSliders(container)).toHaveLength(1);
  });

  it("savings slider lowers spending and the FI number", () => {
    const { container } = renderReady();
    fireEvent.change(screen.getByLabelText("Savings rate"), { target: { value: "70" } });

    // After-tax income 112,500 at a 70% savings rate leaves 33,750 to spend.
    expect(headline("FI number").getByText(whole(33_750 / 0.04))).toBeInTheDocument();
    expect(sliderWrapper("Savings rate")).toHaveAttribute("data-modified", "true");
    expect(modifiedSliders(container)).toHaveLength(1);
  });

  it("a stock allocation reads as a stocks and bonds split", () => {
    renderReady();
    expect(screen.getByText("100% stocks / 0% bonds")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Stock allocation"), { target: { value: "60" } });
    expect(screen.getByText("60% stocks / 40% bonds")).toBeInTheDocument();
  });

  it("reset restores the defaults", () => {
    const { container } = renderReady();
    const reset = screen.getByRole("button", { name: "Reset to defaults" });
    expect(reset).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Safe withdrawal rate"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Stock allocation"), { target: { value: "60" } });
    expect(reset).toBeEnabled();
    expect(headline("FI number").getByText(whole(1_600_000))).toBeInTheDocument();

    fireEvent.click(reset);

    expect(headline("FI number").getByText(whole(1_200_000))).toBeInTheDocument();
    expect(screen.getByLabelText("Safe withdrawal rate")).toHaveValue("4");
    expect(screen.getByLabelText("Stock allocation")).toHaveValue("100");
    expect(modifiedSliders(container)).toHaveLength(0);
    expect(reset).toBeDisabled();
  });

  it("switches to the Coast FI view", () => {
    renderReady();
    const fiTab = screen.getByRole("tab", { name: "Years to FI" });
    const coastTab = screen.getByRole("tab", { name: "Coast FI" });
    expect(fiTab).toHaveAttribute("aria-selected", "true");
    expect(fiTab).toHaveAttribute("data-state", "active");
    expect(coastTab).toHaveAttribute("aria-selected", "false");
    expect(screen.getByText(/of historical starts reach FI by your target age/)).toBeInTheDocument();
    expect(screen.queryByText(/of historical starts are already Coast FI/)).not.toBeInTheDocument();

    fireEvent.click(coastTab);

    expect(coastTab).toHaveAttribute("aria-selected", "true");
    expect(coastTab).toHaveAttribute("data-state", "active");
    expect(fiTab).toHaveAttribute("aria-selected", "false");
    expect(fiTab).toHaveAttribute("data-state", "inactive");
    expect(screen.getByText(/of historical starts are already Coast FI/)).toBeInTheDocument();
    expect(screen.queryByText(/of historical starts reach FI by your target age/)).not.toBeInTheDocument();
  });

  it("replays history only when a lever changes, not when the tab does", () => {
    renderReady();
    const runs = () => vi.mocked(simulateWindows).mock.calls.length;
    const before = runs();

    fireEvent.click(screen.getByRole("tab", { name: "Coast FI" }));
    fireEvent.click(screen.getByRole("tab", { name: "Years to FI" }));
    expect(runs()).toBe(before);

    fireEvent.change(screen.getByLabelText("Safe withdrawal rate"), { target: { value: "3" } });
    expect(runs()).toBe(before + 1);
  });

  it("renders the chart, the five scenarios and the assumptions panel", () => {
    renderReady();
    expect(screen.getByRole("img", { name: /Median projection reaches/ })).toBeInTheDocument();
    for (const label of ["Best", "Optimistic", "Neutral", "Pessimistic", "Worst"]) {
      expect(screen.getByRole("cell", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByText("Investable portfolio", { selector: "dt" })).toBeInTheDocument();
  });

  it("keeps the savings slider on its track when the tax rate moves", () => {
    // Spending of 100,000 against 112,500 after tax saves 11%; at a 60% tax
    // rate it overspends by two thirds. The savings range has to follow the
    // live levers, or its slider would clamp at 0 and show a rate the plan
    // is not using.
    renderReady({ spending: { ...makeInputs().spending, annualSpending: 100_000, regularAnnual: 100_000 } });
    expect(Number(screen.getByLabelText("Savings rate").getAttribute("min"))).toBe(0);

    fireEvent.change(screen.getByLabelText("Effective tax rate"), { target: { value: "60" } });

    expect(Number(screen.getByLabelText("Savings rate").getAttribute("min"))).toBeLessThan(0);
    // Overspending never reaches FI; the page says so rather than printing NaN.
    expect(headline("Years to FI").getByText("Not within 40 years")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("NaN");
  });

  describe("without a derived tax rate", () => {
    const TAX_PROMPT = "Effective tax rate (%)";

    function typeTaxRate(value: string) {
      fireEvent.change(screen.getByLabelText(TAX_PROMPT), { target: { value } });
    }

    // fireEvent.submit rather than a click on the button: happy-dom does not
    // always turn a button click into a form submit (see CLAUDE.md).
    function submitTaxRate() {
      const form = screen.getByLabelText(TAX_PROMPT).closest("form");
      if (!form) throw new Error("The tax prompt is not a form");
      fireEvent.submit(form);
    }

    it("asks for the tax rate when it can't be derived", () => {
      renderReady({ derivedTaxRatePct: null });
      expect(screen.getByText("We couldn't estimate this from your transactions.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Calculate" })).toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "FI number" })).not.toBeInTheDocument();
      // Neither the headline's whole dollars nor the assumptions panel's cents.
      expect(screen.queryByText(whole(1_200_000))).not.toBeInTheDocument();
      expect(screen.queryByText(formatUsd(1_200_000))).not.toBeInTheDocument();
      expect(screen.queryByRole("slider")).not.toBeInTheDocument();

      typeTaxRate("25");
      submitTaxRate();

      expect(headline("FI number").getByText(whole(1_200_000))).toBeInTheDocument();
      // From here the rate is a slider like the others.
      expect(screen.getByLabelText("Effective tax rate")).toHaveValue("25");
      expect(screen.queryByLabelText(TAX_PROMPT)).not.toBeInTheDocument();
    });

    it("waits for the submit, so a rate typed one digit at a time is not committed early", () => {
      renderReady({ derivedTaxRatePct: null });

      // "2" on the way to "25" is a valid rate, and must not open the page.
      typeTaxRate("2");
      expect(screen.getByLabelText(TAX_PROMPT)).toHaveValue(2);
      expect(screen.queryByRole("region", { name: "FI number" })).not.toBeInTheDocument();
      expect(screen.queryByRole("slider")).not.toBeInTheDocument();

      typeTaxRate("25");
      expect(screen.queryByRole("region", { name: "FI number" })).not.toBeInTheDocument();

      submitTaxRate();
      expect(screen.getByLabelText("Effective tax rate")).toHaveValue("25");
    });

    it("submits from the Calculate button", () => {
      renderReady({ derivedTaxRatePct: null });
      typeTaxRate("25");
      fireEvent.click(screen.getByRole("button", { name: "Calculate" }));
      expect(headline("FI number").getByText(whole(1_200_000))).toBeInTheDocument();
    });

    it.each(["", "-1", "60.5", "70"])("keeps the results hidden, and says why, for a submit of %j", (value) => {
      renderReady({ derivedTaxRatePct: null });
      typeTaxRate(value);
      expect(screen.queryByText("Enter a rate from 0 to 60.")).not.toBeInTheDocument();

      submitTaxRate();

      expect(screen.getByText("Enter a rate from 0 to 60.")).toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "FI number" })).not.toBeInTheDocument();
      expect(screen.getByLabelText(TAX_PROMPT)).toBeInTheDocument();
    });

    it("clears the range message when the entry is edited again", () => {
      renderReady({ derivedTaxRatePct: null });
      typeTaxRate("70");
      submitTaxRate();
      expect(screen.getByText("Enter a rate from 0 to 60.")).toBeInTheDocument();

      typeTaxRate("7");
      expect(screen.queryByText("Enter a rate from 0 to 60.")).not.toBeInTheDocument();
    });

    it.each(["0", "60"])("accepts %s, the end of the allowed range", (value) => {
      renderReady({ derivedTaxRatePct: null });
      typeTaxRate(value);
      submitTaxRate();
      expect(screen.getByRole("region", { name: "FI number" })).toBeInTheDocument();
    });

    it("an entered rate becomes the starting value: not a modification, and reset keeps it", () => {
      const { container } = renderReady({ derivedTaxRatePct: null });
      typeTaxRate("25");
      submitTaxRate();
      expect(sliderWrapper("Effective tax rate")).toHaveAttribute("data-modified", "false");
      expect(modifiedSliders(container)).toHaveLength(0);
      expect(screen.getByText("entered by you")).toBeInTheDocument();
      // Nothing has moved off the starting point yet.
      const reset = screen.getByRole("button", { name: "Reset to defaults" });
      expect(reset).toBeDisabled();

      // Moved off the entered rate, it reads as an adjustment of it.
      fireEvent.change(screen.getByLabelText("Effective tax rate"), { target: { value: "30" } });
      expect(sliderWrapper("Effective tax rate")).toHaveAttribute("data-modified", "true");
      expect(screen.getByText("adjusted by you (you entered 25%)")).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText("Safe withdrawal rate"), { target: { value: "3" } });
      expect(reset).toBeEnabled();

      fireEvent.click(reset);

      // Back to the entered rate, not to the prompt.
      expect(screen.queryByLabelText(TAX_PROMPT)).not.toBeInTheDocument();
      expect(screen.getByLabelText("Effective tax rate")).toHaveValue("25");
      expect(screen.getByLabelText("Safe withdrawal rate")).toHaveValue("4");
      expect(headline("FI number").getByText(whole(1_200_000))).toBeInTheDocument();
      expect(screen.getByText("entered by you")).toBeInTheDocument();
      expect(modifiedSliders(container)).toHaveLength(0);
      expect(reset).toBeDisabled();
    });
  });

  it("skips the tax prompt and disables the income sliders when there is no income", () => {
    // What buildFireInputs gives a profile with no income: no cash income, so
    // no derived tax rate.
    renderReady({ grossIncome: 0, cashIncome: 0, employerMatch: 0, derivedTaxRatePct: null });
    // A tax rate on no income changes nothing, so the page does not ask for one.
    expect(screen.queryByLabelText("Effective tax rate (%)")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Savings rate")).toBeDisabled();
    expect(screen.getByLabelText("Effective tax rate")).toBeDisabled();
    expect(screen.getByLabelText("Effective tax rate")).toHaveValue("0");
    // The assumptions panel says the same thing further down, so the hints are
    // looked up inside the sliders.
    expect(within(sliderWrapper("Savings rate")).getByText("No income in your Financial Profile")).toBeInTheDocument();
    expect(
      within(sliderWrapper("Effective tax rate")).getByText("No income in your Financial Profile"),
    ).toBeInTheDocument();
    // The projection still runs, with contributions of −spending + match: a drawdown.
    expect(headline("FI number").getByText(whole(1_200_000))).toBeInTheDocument();
  });

  it("replaces the FI share line with a note past the target age", () => {
    renderReady({ age: 52, targetRetirementAge: 50 });
    expect(screen.queryByText(/of historical starts reach FI by your target age/)).not.toBeInTheDocument();
    expect(screen.getByText(/The share reaching FI is measured against your target age/)).toBeInTheDocument();
  });

  it("keeps the FI share line at the target age itself", () => {
    renderReady({ age: 50, targetRetirementAge: 50 });
    expect(screen.getByText(/of historical starts reach FI by your target age/)).toBeInTheDocument();
    expect(screen.queryByText(/you are past it/)).not.toBeInTheDocument();
  });

  it("explains that Coast FI has no meaning past the target age", () => {
    renderReady({ age: 52, targetRetirementAge: 50 });
    fireEvent.click(screen.getByRole("tab", { name: "Coast FI" }));
    expect(screen.queryByText(/of historical starts are already Coast FI/)).not.toBeInTheDocument();
    expect(screen.getByText(/Coast FI is measured against your target age/)).toBeInTheDocument();
  });

  it("empty states link to the page that fixes them", () => {
    const { unmount } = render(<FireCalculatorClient page={{ state: "no-profile" }} />);
    expect(
      screen.getByRole("link", { name: "Add your Financial Profile to see your FIRE numbers" }),
    ).toHaveAttribute("href", "/financial-profile");
    expect(screen.queryByRole("region", { name: "FI number" })).not.toBeInTheDocument();
    unmount();

    const noSpending: FirePageState = { state: "no-spending" };
    render(<FireCalculatorClient page={noSpending} />);
    expect(
      screen.getByRole("link", { name: "Add or import transactions to estimate your spending" }),
    ).toHaveAttribute("href", "/transactions");
  });

  it("headlines the page in every state", () => {
    render(<FireCalculatorClient page={{ state: "no-profile" }} />);
    expect(screen.getByRole("heading", { level: 1, name: "FIRE Calculator" })).toBeInTheDocument();
  });
});
