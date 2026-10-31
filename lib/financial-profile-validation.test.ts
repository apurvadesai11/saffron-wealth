import { describe, it, expect } from "vitest";
import {
  parseFinancialProfileBody,
  parseNumberInput,
  roundToHundredths,
} from "./financial-profile-validation";

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    age: 35,
    targetRetirementAge: 50,
    expectedRealReturnPct: 5,
    safeWithdrawalRatePct: 3.5,
    inflationPct: 2.5,
    filingStatus: "single",
    employerMatch: { matchPct: 50, limitPct: 6 },
    incomeStreams: [
      { kind: "salary", label: null, annualAmount: 90000, frequency: "biweekly" },
      { kind: "rsu", label: "  Example Co RSUs  ", annualAmount: 20000, frequency: "quarterly" },
    ],
    contributionTargets: [{ accountId: "acct_1", annualAmount: 23000 }],
    ...overrides,
  };
}

function errorsFor(overrides: Record<string, unknown>): Record<string, string> {
  const r = parseFinancialProfileBody(body(overrides));
  if (r.ok) throw new Error("expected a validation failure");
  return r.fieldErrors;
}

describe("parseFinancialProfileBody — whole body", () => {
  it("returns the normalized input for a valid body", () => {
    const r = parseFinancialProfileBody(body());
    expect(r).toEqual({
      ok: true,
      value: {
        age: 35,
        targetRetirementAge: 50,
        expectedRealReturnPct: 5,
        safeWithdrawalRatePct: 3.5,
        inflationPct: 2.5,
        filingStatus: "single",
        employerMatch: { matchPct: 50, limitPct: 6 },
        incomeStreams: [
          { kind: "salary", label: null, annualAmount: 90000, frequency: "biweekly" },
          { kind: "rsu", label: "Example Co RSUs", annualAmount: 20000, frequency: "quarterly" },
        ],
        contributionTargets: [{ accountId: "acct_1", annualAmount: 23000 }],
      },
    });
  });

  it("rejects a non-object body", () => {
    expect(parseFinancialProfileBody(null).ok).toBe(false);
    expect(parseFinancialProfileBody("profile").ok).toBe(false);
  });
});

describe("parseFinancialProfileBody — ages", () => {
  it("requires the age", () => {
    expect(errorsFor({ age: undefined }).age).toBe("Required.");
    expect(errorsFor({ age: null }).age).toBe("Required.");
  });

  it("rejects a non-number and a fractional age", () => {
    expect(errorsFor({ age: "35" }).age).toBe("Enter a number.");
    expect(errorsFor({ age: NaN }).age).toBe("Enter a number.");
    expect(errorsFor({ age: 35.5 }).age).toBe("Enter a whole number.");
  });

  it("bounds ages to 16–100", () => {
    expect(errorsFor({ age: 15 }).age).toMatch(/16 and 100/);
    expect(errorsFor({ age: 101 }).age).toMatch(/16 and 100/);
    expect(errorsFor({ targetRetirementAge: 101 }).targetRetirementAge).toMatch(/16 and 100/);
  });

  it("accepts a retirement age below the current age (already retired)", () => {
    expect(parseFinancialProfileBody(body({ age: 62, targetRetirementAge: 55 })).ok).toBe(true);
  });
});

describe("parseFinancialProfileBody — assumptions", () => {
  it("rounds percents to two decimals the way Postgres stores them", () => {
    const r = parseFinancialProfileBody(
      body({ expectedRealReturnPct: 3.255, inflationPct: -1.005, safeWithdrawalRatePct: 4.125 }),
    );
    expect(r.ok && r.value.expectedRealReturnPct).toBe(3.26);
    expect(r.ok && r.value.inflationPct).toBe(-1.01);
    expect(r.ok && r.value.safeWithdrawalRatePct).toBe(4.13);
  });

  it("requires every assumption", () => {
    const e = errorsFor({
      expectedRealReturnPct: undefined,
      safeWithdrawalRatePct: undefined,
      inflationPct: undefined,
    });
    expect(e.expectedRealReturnPct).toBe("Required.");
    expect(e.safeWithdrawalRatePct).toBe("Required.");
    expect(e.inflationPct).toBe("Required.");
  });

  it("bounds the real return to -10%–20%", () => {
    expect(parseFinancialProfileBody(body({ expectedRealReturnPct: -10 })).ok).toBe(true);
    expect(errorsFor({ expectedRealReturnPct: 20.01 }).expectedRealReturnPct).toBeDefined();
  });

  it("requires a safe withdrawal rate above 0% and at most 10%", () => {
    expect(errorsFor({ safeWithdrawalRatePct: 0 }).safeWithdrawalRatePct).toBeDefined();
    expect(errorsFor({ safeWithdrawalRatePct: 10.5 }).safeWithdrawalRatePct).toBeDefined();
    expect(parseFinancialProfileBody(body({ safeWithdrawalRatePct: 10 })).ok).toBe(true);
  });

  // Review finding: the bounds ran before rounding, so 0.001 passed the
  // "above 0%" check and was stored as 0.00.
  it("checks bounds on the rounded value, so a value that rounds to 0 is refused", () => {
    expect(errorsFor({ safeWithdrawalRatePct: 0.001 }).safeWithdrawalRatePct).toBeDefined();
    expect(
      errorsFor({ employerMatch: { matchPct: 0.004, limitPct: 6 } })["employerMatch.matchPct"],
    ).toBeDefined();
    expect(
      errorsFor({
        incomeStreams: [{ kind: "salary", label: null, annualAmount: 0.004, frequency: null }],
      })["incomeStreams.0.annualAmount"],
    ).toBeDefined();
    // ...and one that rounds back inside the range is accepted.
    expect(parseFinancialProfileBody(body({ expectedRealReturnPct: 20.004 })).ok).toBe(true);
  });

  it("bounds inflation to -5%–20%", () => {
    expect(errorsFor({ inflationPct: -5.5 }).inflationPct).toBeDefined();
  });
});

describe("parseFinancialProfileBody — filing status and employer match", () => {
  it("treats a missing filing status as not specified", () => {
    const r = parseFinancialProfileBody(body({ filingStatus: undefined }));
    expect(r.ok && r.value.filingStatus).toBeNull();
  });

  it("rejects an unknown filing status", () => {
    expect(errorsFor({ filingStatus: "married" }).filingStatus).toBeDefined();
  });

  it("treats a missing or null employer match as none", () => {
    for (const employerMatch of [undefined, null]) {
      const r = parseFinancialProfileBody(body({ employerMatch }));
      expect(r.ok && r.value.employerMatch).toBeNull();
    }
  });

  it("requires both halves of an employer match", () => {
    const e = errorsFor({ employerMatch: { matchPct: 50 } });
    expect(e["employerMatch.limitPct"]).toBe("Required.");
    expect(e["employerMatch.matchPct"]).toBeUndefined();
  });

  it("bounds the match to (0, 200] and the limit to (0, 100]", () => {
    expect(errorsFor({ employerMatch: { matchPct: 0, limitPct: 6 } })["employerMatch.matchPct"]).toBeDefined();
    expect(errorsFor({ employerMatch: { matchPct: 50, limitPct: 101 } })["employerMatch.limitPct"]).toBeDefined();
  });

  it("rejects an employer match without a salary stream", () => {
    const e = errorsFor({
      incomeStreams: [{ kind: "rental", label: null, annualAmount: 18000, frequency: "monthly" }],
    });
    expect(e.employerMatch).toMatch(/salary/i);
  });
});

describe("parseFinancialProfileBody — income streams", () => {
  it("accepts an empty income list", () => {
    const r = parseFinancialProfileBody(body({ incomeStreams: [], employerMatch: null }));
    expect(r.ok && r.value.incomeStreams).toEqual([]);
  });

  it("rejects a missing or non-array list", () => {
    expect(errorsFor({ incomeStreams: undefined }).incomeStreams).toBeDefined();
    expect(errorsFor({ incomeStreams: "salary" }).incomeStreams).toBeDefined();
  });

  it("caps the list at 20 streams", () => {
    const many = Array.from({ length: 21 }, () => ({
      kind: "other", label: null, annualAmount: 100, frequency: null,
    }));
    expect(errorsFor({ incomeStreams: many, employerMatch: null }).incomeStreams).toMatch(/20/);
  });

  it("keys a stream's errors by its index", () => {
    const e = errorsFor({
      incomeStreams: [
        { kind: "salary", label: null, annualAmount: 90000, frequency: "biweekly" },
        { kind: "dividends", label: 7, annualAmount: 0, frequency: "fortnightly" },
      ],
    });
    expect(e["incomeStreams.1.kind"]).toBeDefined();
    expect(e["incomeStreams.1.label"]).toBeDefined();
    expect(e["incomeStreams.1.annualAmount"]).toBeDefined();
    expect(e["incomeStreams.1.frequency"]).toBeDefined();
    expect(e["incomeStreams.0.kind"]).toBeUndefined();
  });

  it("rejects a label over 80 characters and turns a blank one into null", () => {
    expect(
      errorsFor({
        incomeStreams: [{ kind: "salary", label: "x".repeat(81), annualAmount: 1, frequency: null }],
      })["incomeStreams.0.label"],
    ).toBeDefined();
    const r = parseFinancialProfileBody(
      body({ incomeStreams: [{ kind: "salary", label: "   ", annualAmount: 1, frequency: null }] }),
    );
    expect(r.ok && r.value.incomeStreams[0].label).toBeNull();
  });

  it("accepts a null frequency", () => {
    const r = parseFinancialProfileBody(
      body({ incomeStreams: [{ kind: "salary", label: null, annualAmount: 1, frequency: null }] }),
    );
    expect(r.ok && r.value.incomeStreams[0].frequency).toBeNull();
  });

  it("rounds amounts to the cent and rejects ones the column can't hold", () => {
    const r = parseFinancialProfileBody(
      body({ incomeStreams: [{ kind: "salary", label: null, annualAmount: 1.005, frequency: null }] }),
    );
    expect(r.ok && r.value.incomeStreams[0].annualAmount).toBe(1.01);
    expect(
      errorsFor({
        incomeStreams: [{ kind: "salary", label: null, annualAmount: 1e12, frequency: null }],
      })["incomeStreams.0.annualAmount"],
    ).toBeDefined();
  });
});

describe("parseFinancialProfileBody — contribution targets", () => {
  it("accepts an empty list", () => {
    const r = parseFinancialProfileBody(body({ contributionTargets: [] }));
    expect(r.ok && r.value.contributionTargets).toEqual([]);
  });

  it("requires an account and a positive amount", () => {
    const e = errorsFor({ contributionTargets: [{ accountId: "", annualAmount: -5 }] });
    expect(e["contributionTargets.0.accountId"]).toBeDefined();
    expect(e["contributionTargets.0.annualAmount"]).toBeDefined();
  });

  it("flags a repeated account on the second row only", () => {
    const e = errorsFor({
      contributionTargets: [
        { accountId: "acct_1", annualAmount: 100 },
        { accountId: "acct_1", annualAmount: 200 },
      ],
    });
    expect(e["contributionTargets.1.accountId"]).toMatch(/already/);
    expect(e["contributionTargets.0.accountId"]).toBeUndefined();
  });

  it("caps the list at 50 targets", () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ accountId: `acct_${i}`, annualAmount: 1 }));
    expect(errorsFor({ contributionTargets: many }).contributionTargets).toMatch(/50/);
  });
});

describe("parseNumberInput", () => {
  it("reads a blank field as missing", () => {
    expect(parseNumberInput("")).toBeUndefined();
    expect(parseNumberInput("   ")).toBeUndefined();
  });

  it("tolerates thousands separators, a dollar sign and a percent sign", () => {
    expect(parseNumberInput("90,000")).toBe(90000);
    expect(parseNumberInput("$1,250.50")).toBe(1250.5);
    expect(parseNumberInput("3.5%")).toBe(3.5);
    expect(parseNumberInput("-1.5")).toBe(-1.5);
  });

  it("reads anything else as NaN so the parser says 'Enter a number.'", () => {
    expect(parseNumberInput("lots")).toBeNaN();
    expect(parseNumberInput("1.2.3")).toBeNaN();
    expect(parseFinancialProfileBody(body({ age: parseNumberInput("lots") })).ok).toBe(false);
  });
});

describe("roundToHundredths", () => {
  it("rounds half away from zero on the decimal value, not the binary one", () => {
    expect(roundToHundredths(3.255)).toBe(3.26);
    expect(roundToHundredths(-3.255)).toBe(-3.26);
    expect(roundToHundredths(1.004)).toBe(1);
    expect(roundToHundredths(0.0000001)).toBe(0);
  });
});
