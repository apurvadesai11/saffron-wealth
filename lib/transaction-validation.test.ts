import { describe, it, expect } from "vitest";
import {
  validateDescription,
  validateAmount,
  validateTransactionType,
  validateDate,
  parseCreateTransactionBody,
} from "./transaction-validation";

describe("validateDescription", () => {
  it("requires a non-empty description", () => {
    expect(validateDescription("")?.field).toBe("description");
    expect(validateDescription("   ")?.field).toBe("description");
  });
  it("rejects descriptions over 200 chars", () => {
    expect(validateDescription("x".repeat(201))?.field).toBe("description");
  });
  it("accepts a valid description", () => {
    expect(validateDescription("Netflix subscription")).toBeNull();
  });
});

describe("validateAmount", () => {
  it("rejects non-numbers", () => {
    expect(validateAmount("5")?.field).toBe("amount");
    expect(validateAmount(null)?.field).toBe("amount");
    expect(validateAmount(NaN)?.field).toBe("amount");
    expect(validateAmount(Infinity)?.field).toBe("amount");
  });
  it("rejects negative amounts", () => {
    expect(validateAmount(-1)?.field).toBe("amount");
  });
  it("accepts zero (Monarch exports include $0 rows) and positive amounts", () => {
    expect(validateAmount(0)).toBeNull();
    expect(validateAmount(42.5)).toBeNull();
  });
  it("rejects amounts beyond the Decimal(14,2) headroom", () => {
    expect(validateAmount(1e12 + 1)?.field).toBe("amount");
  });
});

describe("validateTransactionType", () => {
  it("accepts income, expense, and transfer", () => {
    expect(validateTransactionType("income")).toBeNull();
    expect(validateTransactionType("expense")).toBeNull();
    expect(validateTransactionType("transfer")).toBeNull();
  });
  it("rejects unknown types", () => {
    expect(validateTransactionType("bogus")?.field).toBe("type");
    expect(validateTransactionType(undefined)?.field).toBe("type");
  });
});

describe("validateDate", () => {
  it("accepts a YYYY-MM-DD string", () => {
    expect(validateDate("2026-07-17")).toBeNull();
  });
  it("rejects malformed or invalid dates", () => {
    expect(validateDate("07/17/2026")?.field).toBe("date");
    expect(validateDate("2026-13-01")?.field).toBe("date");
    expect(validateDate("")?.field).toBe("date");
    expect(validateDate(20260717)?.field).toBe("date");
  });
});

describe("parseCreateTransactionBody", () => {
  it("rejects a non-object body", () => {
    expect(parseCreateTransactionBody(null).ok).toBe(false);
  });

  it("collects field errors for bad input", () => {
    const r = parseCreateTransactionBody({
      description: "",
      amount: -5,
      categoryId: "cat-1",
      type: "bogus",
      date: "not-a-date",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.fieldErrors.description).toBeTruthy();
      expect(r.fieldErrors.amount).toBeTruthy();
      expect(r.fieldErrors.type).toBeTruthy();
      expect(r.fieldErrors.date).toBeTruthy();
    }
  });

  it("requires a categoryId", () => {
    const r = parseCreateTransactionBody({
      description: "Rent", amount: 100, type: "expense", date: "2026-07-01",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors.categoryId).toBeTruthy();
  });

  it("normalizes a valid minimal body (no accountId)", () => {
    const r = parseCreateTransactionBody({
      description: "  Rent  ", amount: 1600, categoryId: "cat-housing",
      type: "expense", date: "2026-07-01",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({
        description: "Rent", amount: 1600, categoryId: "cat-housing",
        type: "expense", date: "2026-07-01", accountId: null,
      });
    }
  });

  it("passes through a provided accountId", () => {
    const r = parseCreateTransactionBody({
      description: "Rent", amount: 1600, categoryId: "cat-housing",
      type: "expense", date: "2026-07-01", accountId: "acc-1",
    });
    expect(r.ok && r.value.accountId).toBe("acc-1");
  });
});
