import { describe, it, expect } from "vitest";
import {
  validateAccountName,
  validateInstitution,
  validateBalance,
  validateAccountType,
  parseCreateAccountBody,
  parseUpdateAccountBody,
} from "./account-validation";

describe("validateAccountName", () => {
  it("requires a non-empty name", () => {
    expect(validateAccountName("")?.field).toBe("name");
    expect(validateAccountName("   ")?.field).toBe("name");
  });
  it("rejects names over 80 chars", () => {
    expect(validateAccountName("x".repeat(81))?.field).toBe("name");
  });
  it("accepts a valid name", () => {
    expect(validateAccountName("Fidelity Brokerage")).toBeNull();
  });
});

describe("validateInstitution", () => {
  it("treats empty/whitespace as valid (optional)", () => {
    expect(validateInstitution("")).toBeNull();
    expect(validateInstitution("   ")).toBeNull();
  });
  it("rejects institutions over 80 chars", () => {
    expect(validateInstitution("x".repeat(81))?.field).toBe("institution");
  });
  it("accepts a valid institution", () => {
    expect(validateInstitution("Vanguard")).toBeNull();
  });
});

describe("validateBalance", () => {
  it("rejects non-numbers", () => {
    expect(validateBalance("100")?.field).toBe("balance");
    expect(validateBalance(null)?.field).toBe("balance");
    expect(validateBalance(undefined)?.field).toBe("balance");
    expect(validateBalance(NaN)?.field).toBe("balance");
    expect(validateBalance(Infinity)?.field).toBe("balance");
  });
  it("rejects negative balances", () => {
    expect(validateBalance(-1)?.field).toBe("balance");
  });
  it("rejects balances beyond the Decimal(14,2) headroom", () => {
    expect(validateBalance(1e12 + 1)?.field).toBe("balance");
  });
  it("accepts zero and valid positive balances", () => {
    expect(validateBalance(0)).toBeNull();
    expect(validateBalance(123456.78)).toBeNull();
  });
});

describe("validateAccountType", () => {
  it("accepts a known type", () => {
    expect(validateAccountType("brokerage")).toBeNull();
    expect(validateAccountType("401k")).toBeNull();
  });
  it("rejects unknown types", () => {
    expect(validateAccountType("savings")?.field).toBe("type");
    expect(validateAccountType(123)?.field).toBe("type");
    expect(validateAccountType(undefined)?.field).toBe("type");
  });
});

describe("parseCreateAccountBody", () => {
  it("rejects a non-object body", () => {
    const r = parseCreateAccountBody(null);
    expect(r.ok).toBe(false);
  });

  it("collects field errors for bad input", () => {
    const r = parseCreateAccountBody({ name: "", type: "nope", balance: -5 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.fieldErrors.name).toBeTruthy();
      expect(r.fieldErrors.type).toBeTruthy();
      expect(r.fieldErrors.balance).toBeTruthy();
    }
  });

  it("normalizes a valid body (trims name, null institution when absent)", () => {
    const r = parseCreateAccountBody({ name: "  Brokerage  ", type: "brokerage", balance: 10000 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({
        name: "Brokerage",
        type: "brokerage",
        institution: null,
        balance: 10000,
      });
    }
  });

  it("trims a provided institution and nulls an empty one", () => {
    const withInst = parseCreateAccountBody({ name: "B", type: "brokerage", balance: 1, institution: "  Vanguard " });
    expect(withInst.ok && withInst.value.institution).toBe("Vanguard");
    const emptyInst = parseCreateAccountBody({ name: "B", type: "brokerage", balance: 1, institution: "  " });
    expect(emptyInst.ok && emptyInst.value.institution).toBeNull();
  });
});

describe("parseUpdateAccountBody", () => {
  it("rejects a non-object body", () => {
    expect(parseUpdateAccountBody(null).ok).toBe(false);
  });

  it("rejects an empty patch", () => {
    const r = parseUpdateAccountBody({});
    expect(r.ok).toBe(false);
  });

  it("accepts a balance-only patch", () => {
    const r = parseUpdateAccountBody({ balance: 5000 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ balance: 5000 });
  });

  it("accepts a type-only patch (type is editable)", () => {
    const r = parseUpdateAccountBody({ type: "credit_card" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ type: "credit_card" });
  });

  it("collects field errors for invalid fields", () => {
    const r = parseUpdateAccountBody({ balance: -1, type: "bogus" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.fieldErrors.balance).toBeTruthy();
      expect(r.fieldErrors.type).toBeTruthy();
    }
  });

  it("allows explicitly clearing the institution to null", () => {
    const r = parseUpdateAccountBody({ institution: null });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ institution: null });
  });
});
