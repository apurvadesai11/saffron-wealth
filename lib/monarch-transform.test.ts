import { describe, it, expect } from "vitest";
import {
  TRANSFER_LIKE_CATEGORIES,
  NON_ACCOUNT_NAMES,
  parseAmount,
  classifyTransaction,
  inferCategoryType,
  buildExternalHash,
  guessAccountType,
} from "./monarch-transform";

describe("TRANSFER_LIKE_CATEGORIES", () => {
  it("is the exact three names from Decision 1", () => {
    expect(TRANSFER_LIKE_CATEGORIES).toEqual(["transfer", "balance adjustments", "credit card payment"]);
  });
});

describe("NON_ACCOUNT_NAMES", () => {
  it("is the two medical trackers from Ruling 5", () => {
    expect(NON_ACCOUNT_NAMES).toEqual([
      "Individual innetwork medical deductible",
      "Individual innetwork medical outofpocket",
    ]);
  });
});

describe("parseAmount", () => {
  it("parses a plain signed decimal", () => {
    expect(parseAmount("-200.00")).toBe(-200);
  });

  it("strips a leading dollar sign and thousands commas", () => {
    expect(parseAmount("$1,234.56")).toBe(1234.56);
  });

  it("treats wrapping parentheses as negative", () => {
    expect(parseAmount("(45.00)")).toBe(-45);
  });

  it("throws on unparseable input", () => {
    expect(() => parseAmount("not a number")).toThrow();
    expect(() => parseAmount("")).toThrow();
  });
});

describe("classifyTransaction", () => {
  it("classifies a negative amount as an expense", () => {
    expect(classifyTransaction("Groceries", -55.5)).toEqual({ type: "expense", amount: 55.5 });
  });

  it("classifies a positive amount as income", () => {
    expect(classifyTransaction("Paycheck", 2000)).toEqual({ type: "income", amount: 2000 });
  });

  it.each(TRANSFER_LIKE_CATEGORIES)(
    "routes transfer-like category %s to 'transfer' regardless of sign",
    (categoryName) => {
      expect(classifyTransaction(categoryName, -419)).toEqual({ type: "transfer", amount: 419 });
      expect(classifyTransaction(categoryName, 419)).toEqual({ type: "transfer", amount: 419 });
    },
  );

  it("matches transfer-like names case-insensitively and trims whitespace", () => {
    expect(classifyTransaction("  Transfer  ", -100)).toEqual({ type: "transfer", amount: 100 });
    expect(classifyTransaction("CREDIT CARD PAYMENT", 100)).toEqual({ type: "transfer", amount: 100 });
  });
});

describe("inferCategoryType", () => {
  it("returns 'transfer' for a transfer-like name without inspecting amounts", () => {
    // All-positive amounts would otherwise read as income — proves the
    // transfer-like check short-circuits before any sign counting happens.
    expect(inferCategoryType("Balance Adjustments", [100, 200, 300])).toBe("transfer");
  });

  it("picks the dominant sign across the batch", () => {
    expect(inferCategoryType("Groceries", [-10, -20, 5])).toBe("expense");
    expect(inferCategoryType("Freelance", [500, 300, -50])).toBe("income");
  });

  it("defaults to 'expense' on a tie or an empty array", () => {
    expect(inferCategoryType("Mixed", [-10, 10])).toBe("expense");
    expect(inferCategoryType("NoHistory", [])).toBe("expense");
  });
});

describe("buildExternalHash", () => {
  it("prefers mid: when id is a non-empty string", () => {
    const hash = buildExternalHash({
      id: "abc123",
      date: "2026-01-05",
      amount: -50,
      account: "Checking",
      merchant: "Coffee Shop",
      originalStatement: "COFFEE SHOP #123",
    });
    expect(hash).toBe("mid:abc123");
  });

  it("falls back to a stable sha: hash when id is absent", () => {
    const input = {
      id: undefined,
      date: "2026-01-05",
      amount: -50,
      account: "Checking",
      merchant: "Coffee Shop",
      originalStatement: "COFFEE SHOP #123",
    };
    const first = buildExternalHash(input);
    const second = buildExternalHash(input);
    expect(first).toMatch(/^sha:[0-9a-f]{64}$/);
    expect(first).toBe(second);
  });

  it("falls back to sha: when id is an empty string", () => {
    const hash = buildExternalHash({
      id: "",
      date: "2026-01-05",
      amount: -50,
      account: "Checking",
      merchant: "Coffee Shop",
      originalStatement: "COFFEE SHOP #123",
    });
    expect(hash).toMatch(/^sha:/);
  });
});

describe("guessAccountType", () => {
  // One case per asset-branch keyword row, in table order.
  it("row 1: 'roth 401'/'roth401' -> roth_401k (beats plain 401k)", () => {
    expect(guessAccountType("Roth 401(k) Plan")).toBe("roth_401k");
  });

  it("row 2: '401(k)'/'401k' -> 401k", () => {
    expect(guessAccountType("ACME, INC. 401(K) PLAN", 50000)).toBe("401k");
  });

  it("row 3: 'roth ira' -> roth_ira", () => {
    expect(guessAccountType("Roth IRA (...1234)")).toBe("roth_ira");
  });

  it("row 4: 'traditional ira' -> traditional_ira", () => {
    expect(guessAccountType("Traditional IRA (...3333)")).toBe("traditional_ira");
  });

  it("row 5: bare 'ira' -> traditional_ira", () => {
    expect(guessAccountType("My IRA")).toBe("traditional_ira");
  });

  it("row 6: 'hsa'/'health savings' -> hsa", () => {
    expect(guessAccountType("Further HSA (...5678)")).toBe("hsa");
  });

  it("row 7: 'restricted unit'/'rsu' -> rsu", () => {
    expect(guessAccountType("ACME RESTRICTED UNIT (...*****7777)")).toBe("rsu");
  });

  it("row 8: 'stock plan'/'stock purchase'/'espp' -> espp", () => {
    expect(guessAccountType("ACME STOCK PURCHASE (...5555)")).toBe("espp");
  });

  it("row 9: 'brokerage'/'individual'/'invest' -> brokerage", () => {
    expect(guessAccountType("Brokerage (...4444)")).toBe("brokerage");
  });

  it("row 10: 'property'/'real estate'/'house' -> property", () => {
    expect(guessAccountType("Rental Property")).toBe("property");
  });

  it("row 11: card-network keywords -> credit_card (balance undefined, no liability branch)", () => {
    expect(guessAccountType("Chase Visa")).toBe("credit_card");
  });

  it("row 12: 'checking'/'banking'/'savings'/'cash' -> cash", () => {
    expect(guessAccountType("Everyday Checking")).toBe("cash");
  });

  it("row 13: no keyword match -> cash (documented accepted miss for '1200 maple')", () => {
    expect(guessAccountType("1200 maple")).toBe("cash");
  });

  // Named specific cases from the brief, beyond the per-row floor.
  it("negative balance + 'Orig. $' marker -> loan_mortgage", () => {
    expect(guessAccountType("1200 MAPLE STREET (Orig. $500,000.00) (...1111)", -816964.68)).toBe(
      "loan_mortgage",
    );
  });

  it("negative balance + 'Sapphire Preferred' -> credit_card", () => {
    expect(guessAccountType("Sapphire Preferred", -1200)).toBe("credit_card");
  });

  it("'INDIVIDUAL - Globex RSU' -> rsu, not brokerage (rsu beats individual)", () => {
    expect(guessAccountType("INDIVIDUAL - Globex RSU")).toBe("rsu");
  });

  it("'Health savings investments - HSA' -> hsa, not cash (health savings beats savings)", () => {
    expect(guessAccountType("Health savings investments - HSA")).toBe("hsa");
  });

  it("'Advantage Savings' -> cash", () => {
    expect(guessAccountType("Advantage Savings")).toBe("cash");
  });
});
