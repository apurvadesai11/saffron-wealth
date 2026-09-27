import { describe, it, expect } from "vitest";
import { validateBudgetAmount, validateBudgetPeriod, parseSaveBudgetsBody } from "./budget-validation";

describe("validateBudgetAmount", () => {
  it("accepts zero (hidden-from-budgets sentinel) and positive amounts", () => {
    expect(validateBudgetAmount(0)).toBeNull();
    expect(validateBudgetAmount(500)).toBeNull();
  });
  it("rejects negative or non-finite amounts", () => {
    expect(validateBudgetAmount(-1)?.field).toBe("amount");
    expect(validateBudgetAmount(NaN)?.field).toBe("amount");
    expect(validateBudgetAmount("500")?.field).toBe("amount");
  });
});

describe("validateBudgetPeriod", () => {
  it("accepts all four BudgetPeriod values", () => {
    for (const p of ["monthly", "quarterly", "semi-annual", "annual"]) {
      expect(validateBudgetPeriod(p)).toBeNull();
    }
  });
  it("rejects unknown periods", () => {
    expect(validateBudgetPeriod("weekly")?.field).toBe("period");
    expect(validateBudgetPeriod(undefined)?.field).toBe("period");
  });
});

describe("parseSaveBudgetsBody", () => {
  it("rejects a non-object body", () => {
    expect(parseSaveBudgetsBody(null).ok).toBe(false);
  });

  it("rejects a body without an entries array", () => {
    const r = parseSaveBudgetsBody({});
    expect(r.ok).toBe(false);
  });

  it("rejects an empty entries array", () => {
    const r = parseSaveBudgetsBody({ entries: [] });
    expect(r.ok).toBe(false);
  });

  it("collects per-entry field errors, indexed", () => {
    const r = parseSaveBudgetsBody({
      entries: [
        { categoryId: "cat-1", amount: -5, period: "monthly" },
        { categoryId: "", amount: 100, period: "bogus" },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.fieldErrors["0.amount"]).toBeTruthy();
      expect(r.fieldErrors["1.categoryId"]).toBeTruthy();
      expect(r.fieldErrors["1.period"]).toBeTruthy();
    }
  });

  it("normalizes a valid single-entry body (matches a manual budget save)", () => {
    const r = parseSaveBudgetsBody({ entries: [{ categoryId: "cat-1", amount: 500, period: "monthly" }] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual([{ categoryId: "cat-1", amount: 500, period: "monthly" }]);
    }
  });

  it("normalizes a valid multi-entry body (matches Auto-Set All)", () => {
    const r = parseSaveBudgetsBody({
      entries: [
        { categoryId: "cat-1", amount: 500, period: "monthly" },
        { categoryId: "cat-2", amount: 0, period: "monthly" },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toHaveLength(2);
  });
});
