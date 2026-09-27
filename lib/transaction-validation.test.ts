import { describe, it, expect } from "vitest";
import {
  validateDescription,
  validateAmount,
  validateTransactionType,
  validateDate,
  parseTransactionQueryParams,
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

describe("parseTransactionQueryParams", () => {
  function params(init: Record<string, string>) {
    return new URLSearchParams(init);
  }

  it("returns an empty query for no params", () => {
    const r = parseTransactionQueryParams(params({}));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({});
  });

  it("reads a date range", () => {
    const r = parseTransactionQueryParams(params({ from: "2026-01-01", to: "2026-09-30" }));
    expect(r.ok && r.value.from).toBe("2026-01-01");
    expect(r.ok && r.value.to).toBe("2026-09-30");
  });

  it("rejects a malformed date", () => {
    const r = parseTransactionQueryParams(params({ from: "01/01/2026" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors.from).toBeDefined();
  });

  it("rejects a range whose end precedes its start", () => {
    const r = parseTransactionQueryParams(params({ from: "2026-09-30", to: "2026-01-01" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors.to).toBeDefined();
  });

  it("reads a valid category type", () => {
    const r = parseTransactionQueryParams(params({ type: "income" }));
    expect(r.ok && r.value.type).toBe("income");
  });

  it("treats type=all as no type filter", () => {
    const r = parseTransactionQueryParams(params({ type: "all" }));
    expect(r.ok && r.value.type).toBeUndefined();
  });

  it("rejects an unknown type", () => {
    const r = parseTransactionQueryParams(params({ type: "refund" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors.type).toBeDefined();
  });

  it("splits categoryIds on commas and drops empties", () => {
    const r = parseTransactionQueryParams(params({ categoryIds: "a,,b," }));
    expect(r.ok && r.value.categoryIds).toEqual(["a", "b"]);
  });

  it("reads an amount range", () => {
    const r = parseTransactionQueryParams(params({ amountMin: "10", amountMax: "99.5" }));
    expect(r.ok && r.value.amountMin).toBe(10);
    expect(r.ok && r.value.amountMax).toBe(99.5);
  });

  it("rejects a non-numeric amount", () => {
    const r = parseTransactionQueryParams(params({ amountMin: "cheap" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors.amountMin).toBeDefined();
  });

  it("rejects an amount range whose max is below its min", () => {
    const r = parseTransactionQueryParams(params({ amountMin: "100", amountMax: "10" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors.amountMax).toBeDefined();
  });

  it("trims the search term and drops it when empty", () => {
    expect(parseTransactionQueryParams(params({ search: "  coffee " })).ok).toBe(true);
    const r = parseTransactionQueryParams(params({ search: "  coffee " }));
    expect(r.ok && r.value.search).toBe("coffee");
    const blank = parseTransactionQueryParams(params({ search: "   " }));
    expect(blank.ok && blank.value.search).toBeUndefined();
  });

  it("rejects a limit that isn't a positive integer", () => {
    const r = parseTransactionQueryParams(params({ limit: "0" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors.limit).toBeDefined();
  });

  it("rejects a limit above the page-size ceiling", () => {
    const r = parseTransactionQueryParams(params({ limit: "5000" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors.limit).toBeDefined();
  });

  it("passes the cursor through", () => {
    const r = parseTransactionQueryParams(params({ cursor: "ckz123" }));
    expect(r.ok && r.value.cursor).toBe("ckz123");
  });
});
