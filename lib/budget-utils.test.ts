import { describe, it, expect } from "vitest";
import {
  getPeriodBounds,
  getPeriodKey,
  getCurrentPeriodSpend,
  getHistoricalAverage,
  getProgressPercent,
  getExpenseBarColor,
  getIncomeBarColor,
  getDaysRemainingInPeriod,
  getDaysElapsedInPeriod,
  buildBudgetProgressList,
  getPendingAlerts,
  formatAlertMessage,
  getCashflowProjection,
} from "./budget-utils";
import type { Budget, Category, AlertRecord } from "./types";
import { MOCK_CATEGORIES, MOCK_TRANSACTIONS, MOCK_BUDGETS } from "./mock-data";

// Mid-February 2026, day 14 — matches the mock-data narrative ("partial through ~day 14")
const FEB_14_2026 = new Date(2026, 1, 14);

describe("getPeriodBounds", () => {
  it("returns first and last day for monthly", () => {
    const [start, end] = getPeriodBounds(FEB_14_2026, "monthly");
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(1);
    expect(start.getDate()).toBe(1);
    expect(end.getFullYear()).toBe(2026);
    expect(end.getMonth()).toBe(1);
    expect(end.getDate()).toBe(28); // 2026 is not a leap year
  });

  it("handles leap-year February", () => {
    const [, end] = getPeriodBounds(new Date(2024, 1, 5), "monthly");
    expect(end.getDate()).toBe(29);
  });

  it("returns quarter bounds for quarterly", () => {
    const [start, end] = getPeriodBounds(FEB_14_2026, "quarterly");
    expect(start.getMonth()).toBe(0);  // Jan
    expect(end.getMonth()).toBe(2);    // Mar
    expect(end.getDate()).toBe(31);
  });

  it("returns half bounds for semi-annual", () => {
    const h1 = getPeriodBounds(new Date(2026, 3, 10), "semi-annual"); // Apr → H1
    expect(h1[0].getMonth()).toBe(0);
    expect(h1[1].getMonth()).toBe(5);
    expect(h1[1].getDate()).toBe(30);

    const h2 = getPeriodBounds(new Date(2026, 9, 1), "semi-annual"); // Oct → H2
    expect(h2[0].getMonth()).toBe(6);
    expect(h2[1].getMonth()).toBe(11);
    expect(h2[1].getDate()).toBe(31);
  });

  it("returns full year for annual", () => {
    const [start, end] = getPeriodBounds(FEB_14_2026, "annual");
    expect(start.getMonth()).toBe(0);
    expect(start.getDate()).toBe(1);
    expect(end.getMonth()).toBe(11);
    expect(end.getDate()).toBe(31);
  });
});

describe("getPeriodKey", () => {
  it("formats monthly as YYYY-MM with zero-pad", () => {
    expect(getPeriodKey(new Date(2026, 0, 5),  "monthly")).toBe("2026-01");
    expect(getPeriodKey(new Date(2026, 11, 5), "monthly")).toBe("2026-12");
  });

  it("formats quarterly as YYYY-Qn", () => {
    expect(getPeriodKey(new Date(2026, 0, 1),  "quarterly")).toBe("2026-Q1");
    expect(getPeriodKey(new Date(2026, 3, 1),  "quarterly")).toBe("2026-Q2");
    expect(getPeriodKey(new Date(2026, 6, 1),  "quarterly")).toBe("2026-Q3");
    expect(getPeriodKey(new Date(2026, 9, 1),  "quarterly")).toBe("2026-Q4");
  });

  it("formats semi-annual as YYYY-Hn", () => {
    expect(getPeriodKey(new Date(2026, 0, 1),  "semi-annual")).toBe("2026-H1");
    expect(getPeriodKey(new Date(2026, 6, 1),  "semi-annual")).toBe("2026-H2");
  });

  it("formats annual as YYYY", () => {
    expect(getPeriodKey(FEB_14_2026, "annual")).toBe("2026");
  });
});

describe("getCurrentPeriodSpend", () => {
  it("sums only matching category in the asOf month", () => {
    const groceriesFeb = getCurrentPeriodSpend(MOCK_TRANSACTIONS, "groceries", "monthly", FEB_14_2026);
    // Feb groceries: $95 + $85 = $180 (per mock-data narrative)
    expect(groceriesFeb).toBe(180);
  });

  it("returns 0 when no transactions in the period", () => {
    const empty = getCurrentPeriodSpend([], "groceries", "monthly", FEB_14_2026);
    expect(empty).toBe(0);
  });

  it("excludes transactions outside the period", () => {
    // January transactions exist for groceries but should NOT be counted in Feb
    const housingFeb = getCurrentPeriodSpend(MOCK_TRANSACTIONS, "housing", "monthly", FEB_14_2026);
    expect(housingFeb).toBe(1600); // single Feb-only rent payment
  });

  it("respects period boundaries (last day of month)", () => {
    const lastDayJan = new Date(2026, 0, 31);
    const housingJan = getCurrentPeriodSpend(MOCK_TRANSACTIONS, "housing", "monthly", lastDayJan);
    expect(housingJan).toBe(1600);
  });
});

describe("getHistoricalAverage", () => {
  it("returns null for categories with no history", () => {
    const result = getHistoricalAverage([], "groceries", "monthly", FEB_14_2026);
    expect(result).toBeNull();
  });

  it("averages over months that had spend", () => {
    // Groceries history: Jan $215, Dec $235, Nov $190 → (215+235+190)/3 ≈ 213.33
    const result = getHistoricalAverage(MOCK_TRANSACTIONS, "groceries", "monthly", FEB_14_2026);
    expect(result).not.toBeNull();
    expect(result!.periodsOfData).toBe(3);
    expect(result!.average).toBeCloseTo((215 + 235 + 190) / 3, 2);
  });

  it("does not include the current asOf month", () => {
    // Feb groceries spend ($180) should NOT be in the historical average
    const result = getHistoricalAverage(MOCK_TRANSACTIONS, "groceries", "monthly", FEB_14_2026);
    expect(result!.average).not.toBeCloseTo(180, 2);
  });

  it("returns null for non-monthly periods (v1 stub)", () => {
    expect(getHistoricalAverage(MOCK_TRANSACTIONS, "groceries", "quarterly",   FEB_14_2026)).toBeNull();
    expect(getHistoricalAverage(MOCK_TRANSACTIONS, "groceries", "semi-annual", FEB_14_2026)).toBeNull();
    expect(getHistoricalAverage(MOCK_TRANSACTIONS, "groceries", "annual",      FEB_14_2026)).toBeNull();
  });
});

describe("getProgressPercent", () => {
  it("returns 0 when budget is 0 (avoids div-by-zero)", () => {
    expect(getProgressPercent(50, 0)).toBe(0);
  });

  it("computes percent with full precision", () => {
    expect(getProgressPercent(80,  100)).toBe(80);
    expect(getProgressPercent(150, 100)).toBe(150); // over budget
    expect(getProgressPercent(0,   100)).toBe(0);
  });
});

describe("getExpenseBarColor", () => {
  it.each([
    [0,    "green"],
    [79.9, "green"],
    [80,   "yellow"],
    [99.9, "yellow"],
    [100,  "red"],
    [100.1,"deep-red"],
    [200,  "deep-red"],
  ] as const)("percent=%s → %s", (percent, expected) => {
    expect(getExpenseBarColor(percent)).toBe(expected);
  });
});

describe("getIncomeBarColor", () => {
  it.each([
    [0,    "red"],
    [49.9, "red"],
    [50,   "orange"],
    [79.9, "orange"],
    [80,   "yellow"],
    [99.9, "yellow"],
    [100,  "green"],
    [200,  "green"],
  ] as const)("percent=%s → %s", (percent, expected) => {
    expect(getIncomeBarColor(percent)).toBe(expected);
  });
});

describe("getDaysRemainingInPeriod", () => {
  it("counts inclusive remaining days", () => {
    // Feb 14 in a 28-day month → 14 + today = 15 days remaining
    expect(getDaysRemainingInPeriod(FEB_14_2026, "monthly")).toBe(15);
  });

  it("returns 1 on the last day of the month", () => {
    expect(getDaysRemainingInPeriod(new Date(2026, 1, 28), "monthly")).toBe(1);
  });

  it("returns total days on day 1", () => {
    expect(getDaysRemainingInPeriod(new Date(2026, 1, 1), "monthly")).toBe(28);
  });
});

describe("getDaysElapsedInPeriod", () => {
  it("counts inclusive elapsed days", () => {
    expect(getDaysElapsedInPeriod(FEB_14_2026, "monthly")).toBe(14);
  });

  it("returns at least 1 on day 1", () => {
    expect(getDaysElapsedInPeriod(new Date(2026, 1, 1), "monthly")).toBe(1);
  });
});

describe("buildBudgetProgressList", () => {
  it("returns one BudgetProgress per category with a budget", () => {
    const result = buildBudgetProgressList(MOCK_CATEGORIES, MOCK_BUDGETS, MOCK_TRANSACTIONS, FEB_14_2026);
    expect(result.length).toBe(MOCK_BUDGETS.length);
  });

  it("excludes categories without a budget (FR-06)", () => {
    const partialBudgets: Budget[] = [{ categoryId: "housing", amount: 1600, period: "monthly" }];
    const result = buildBudgetProgressList(MOCK_CATEGORIES, partialBudgets, MOCK_TRANSACTIONS, FEB_14_2026);
    expect(result.length).toBe(1);
    expect(result[0].categoryId).toBe("housing");
  });

  it("returns isHidden=true for $0 budgets", () => {
    const hiddenBudgets: Budget[] = [{ categoryId: "housing", amount: 0, period: "monthly" }];
    const result = buildBudgetProgressList(MOCK_CATEGORIES, hiddenBudgets, MOCK_TRANSACTIONS, FEB_14_2026);
    expect(result[0].isHidden).toBe(true);
    expect(result[0].percent).toBe(0);
  });

  it("computes percent and bar color from spend", () => {
    const result = buildBudgetProgressList(MOCK_CATEGORIES, MOCK_BUDGETS, MOCK_TRANSACTIONS, FEB_14_2026);

    const housing = result.find(p => p.categoryId === "housing")!;
    expect(housing.spent).toBe(1600);
    expect(housing.percent).toBe(100);
    expect(housing.barColor).toBe("red");

    // Entertainment is over budget per mock narrative ($123 vs $100)
    const entertainment = result.find(p => p.categoryId === "entertainment")!;
    expect(entertainment.percent).toBeGreaterThan(100);
    expect(entertainment.barColor).toBe("deep-red");
  });

  it("uses income bar colors for income categories", () => {
    const result = buildBudgetProgressList(MOCK_CATEGORIES, MOCK_BUDGETS, MOCK_TRANSACTIONS, FEB_14_2026);
    const salary = result.find(p => p.categoryId === "salary")!;
    expect(salary.categoryType).toBe("income");
    expect(salary.barColor).toBe("green"); // 100% received
  });
});

describe("getPendingAlerts", () => {
  const housingBudget: Budget = { categoryId: "housing", amount: 1000, period: "monthly" };

  it("returns no alerts when under 80%", () => {
    expect(getPendingAlerts(500, housingBudget, [], "housing", FEB_14_2026)).toEqual([]);
  });

  it("fires the 80% threshold when crossed and not yet fired", () => {
    expect(getPendingAlerts(800, housingBudget, [], "housing", FEB_14_2026)).toEqual([80]);
  });

  it("fires both thresholds when crossed and not fired", () => {
    expect(getPendingAlerts(1000, housingBudget, [], "housing", FEB_14_2026)).toEqual([80, 100]);
  });

  it("does not re-fire a previously-fired threshold for the same period", () => {
    const fired: AlertRecord[] = [{
      categoryId: "housing",
      periodKey: "2026-02",
      threshold: 80,
      firedAt: new Date().toISOString(),
    }];
    expect(getPendingAlerts(800, housingBudget, fired, "housing", FEB_14_2026)).toEqual([]);
  });

  it("returns no alerts for hidden ($0) budgets (FR-14)", () => {
    const hidden: Budget = { ...housingBudget, amount: 0 };
    expect(getPendingAlerts(500, hidden, [], "housing", FEB_14_2026)).toEqual([]);
  });

  it("scopes fired records to category + periodKey", () => {
    const wrongCategory: AlertRecord[] = [{
      categoryId: "groceries", // different category
      periodKey: "2026-02",
      threshold: 80,
      firedAt: new Date().toISOString(),
    }];
    expect(getPendingAlerts(800, housingBudget, wrongCategory, "housing", FEB_14_2026)).toEqual([80]);

    const wrongPeriod: AlertRecord[] = [{
      categoryId: "housing",
      periodKey: "2026-01", // different period
      threshold: 80,
      firedAt: new Date().toISOString(),
    }];
    expect(getPendingAlerts(800, housingBudget, wrongPeriod, "housing", FEB_14_2026)).toEqual([80]);
  });
});

describe("formatAlertMessage", () => {
  it("formats the 80% message", () => {
    const msg = formatAlertMessage(80, "Groceries", 320, 400, 10);
    expect(msg).toBe("You've used 80% of your Groceries budget. $80 left with 10 days to go.");
  });

  it("formats the 100% message with overage", () => {
    const msg = formatAlertMessage(100, "Dining Out", 250, 200, 5);
    expect(msg).toBe("You've reached your Dining Out budget. You're $50 over with 5 days remaining.");
  });

  it("uses singular 'day' for 1 day", () => {
    expect(formatAlertMessage(80, "X", 80, 100, 1)).toContain("1 day to");
    expect(formatAlertMessage(100, "X", 100, 100, 1)).toContain("1 day remaining");
  });

  it("floors remaining at $0 in the 80% message", () => {
    // Spent over budget but the 80% message should never show negative left
    const msg = formatAlertMessage(80, "X", 150, 100, 10);
    expect(msg).toContain("$0 left");
  });

  it("floors overage at $0 in the 100% message when not over", () => {
    const msg = formatAlertMessage(100, "X", 100, 100, 10);
    expect(msg).toContain("$0 over");
  });
});

describe("getCashflowProjection", () => {
  const incomeOnlyBudgets: Budget[] = [
    { categoryId: "salary",    amount: 4500, period: "monthly" },
    { categoryId: "freelance", amount:  800, period: "monthly" },
  ];
  const expenseOnlyBudgets: Budget[] = [
    { categoryId: "housing",   amount: 1600, period: "monthly" },
    { categoryId: "groceries", amount:  400, period: "monthly" },
  ];
  const budgets = [...incomeOnlyBudgets, ...expenseOnlyBudgets];

  it("falls back to static projection on day 1 (FR-24)", () => {
    const day1 = new Date(2026, 1, 1);
    const result = getCashflowProjection(MOCK_TRANSACTIONS, budgets, MOCK_CATEGORIES, day1);
    expect(result.isStaticProjection).toBe(true);
    expect(result.budgetedIncome).toBe(4500 + 800);
    expect(result.budgetedExpenses).toBe(1600 + 400);
    expect(result.projectedExpenses).toBe(result.budgetedExpenses);
    expect(result.projectedNet).toBe(result.budgetedIncome - result.budgetedExpenses);
  });

  it("falls back to static when no transactions in the period", () => {
    const result = getCashflowProjection([], budgets, MOCK_CATEGORIES, FEB_14_2026);
    expect(result.isStaticProjection).toBe(true);
    expect(result.projectedExpenses).toBe(result.budgetedExpenses);
  });

  it("rate-extrapolates expenses when there are transactions past day 1", () => {
    // Feb 14 mock totals across ALL expense categories:
    //   housing 1600 + groceries 180 + dining 112 + transport 122
    //   + entertainment 123 + utilities 130 = $2267 in 14 days.
    // Each category is rate-extrapolated independently to 28 days; sum = 2267 × 28/14 = 4534.
    const result = getCashflowProjection(MOCK_TRANSACTIONS, budgets, MOCK_CATEGORIES, FEB_14_2026);
    expect(result.isStaticProjection).toBe(false);
    expect(result.projectedExpenses).toBeCloseTo(4534, 0);
    expect(result.projectedNet).toBeCloseTo(result.budgetedIncome - 4534, 0);
  });

  it("uses budgetedIncome as static income (no income rate-extrapolation)", () => {
    const result = getCashflowProjection(MOCK_TRANSACTIONS, budgets, MOCK_CATEGORIES, FEB_14_2026);
    expect(result.budgetedIncome).toBe(4500 + 800);
  });

  it("treats categories with no budget as zero", () => {
    const sparse: Budget[] = [{ categoryId: "housing", amount: 1600, period: "monthly" }];
    const result = getCashflowProjection([], sparse, MOCK_CATEGORIES, new Date(2026, 1, 1));
    expect(result.budgetedExpenses).toBe(1600);
    expect(result.budgetedIncome).toBe(0);
  });
});

describe("integration: budget progress + alerts + message", () => {
  it("over-budget category produces a 100% alert with sensible overage message", () => {
    const cat: Category = MOCK_CATEGORIES.find(c => c.id === "entertainment")!;
    const budget: Budget = { categoryId: cat.id, amount: 100, period: "monthly" };
    const spent = getCurrentPeriodSpend(MOCK_TRANSACTIONS, cat.id, "monthly", FEB_14_2026);
    const alerts = getPendingAlerts(spent, budget, [], cat.id, FEB_14_2026);
    expect(alerts).toContain(100);

    const msg = formatAlertMessage(
      100,
      cat.name,
      spent,
      budget.amount,
      getDaysRemainingInPeriod(FEB_14_2026, "monthly"),
    );
    expect(msg).toMatch(/Entertainment/);
    expect(msg).toMatch(/\$\d+ over/);
  });
});

describe("integration: empty state", () => {
  it("a fresh app (no transactions, no budgets) produces empty progress and no alerts", () => {
    const progress = buildBudgetProgressList(MOCK_CATEGORIES, [], [], FEB_14_2026);
    expect(progress).toEqual([]);

    const projection = getCashflowProjection([], [], MOCK_CATEGORIES, FEB_14_2026);
    expect(projection.budgetedIncome).toBe(0);
    expect(projection.budgetedExpenses).toBe(0);
    expect(projection.projectedNet).toBe(0);
    expect(projection.isStaticProjection).toBe(true);
  });
});
