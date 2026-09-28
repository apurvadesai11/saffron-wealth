// The bar in this directory is one test file per module (CLAUDE.md), and this
// one had none despite owning email normalization — the function the
// account-takeover chain in item 4 runs through. normalizeEmail is what decides
// whether two addresses are "the same account", so its exact behavior is
// security-relevant, not cosmetic.
import { describe, it, expect } from "vitest";
import {
  normalizeEmail,
  validateEmail,
  validateName,
  parseRegisterBody,
  parseLoginBody,
} from "./validation";

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Ada.Lovelace@Example.COM  ")).toBe("ada.lovelace@example.com");
  });

  it("is idempotent", () => {
    const once = normalizeEmail(" A@B.com ");
    expect(normalizeEmail(once)).toBe(once);
  });

  // The identity rule, stated as a property: case and surrounding whitespace
  // must never distinguish two accounts, because emailNormalized is the
  // unique key.
  it("collapses case and padding variants to one key", () => {
    const variants = ["a@b.com", "A@B.COM", " a@b.com", "a@b.com\t", "A@b.Com "];
    const normalized = new Set(variants.map(normalizeEmail));
    expect(normalized.size).toBe(1);
  });

  // What it deliberately does NOT do. Gmail treats these as the same mailbox;
  // this app does not, and that is a decision rather than an oversight — the
  // alternative is guessing per-provider aliasing rules.
  it("does not strip dots or +tags, so those remain distinct accounts", () => {
    expect(normalizeEmail("a.b@gmail.com")).not.toBe(normalizeEmail("ab@gmail.com"));
    expect(normalizeEmail("a+tag@gmail.com")).not.toBe(normalizeEmail("a@gmail.com"));
  });

  // Unicode case folding is not applied — normalizeEmail is toLowerCase, and
  // pinning that stops a future "improvement" from silently merging accounts.
  it("leaves non-ASCII alone beyond simple lowercasing", () => {
    expect(normalizeEmail("ÄSA@example.com")).toBe("äsa@example.com");
  });
});

describe("validateEmail", () => {
  it("accepts an ordinary address", () => {
    expect(validateEmail("ada@example.com")).toBeNull();
  });

  it("accepts an address that only needs trimming", () => {
    expect(validateEmail("  ada@example.com ")).toBeNull();
  });

  it("requires a value", () => {
    expect(validateEmail("")?.message).toMatch(/required/i);
    expect(validateEmail("   ")?.message).toMatch(/required/i);
  });

  it("caps length at 254, the SMTP path limit", () => {
    const local = "a".repeat(244);
    expect(validateEmail(`${local}@ex.com`)).toBeNull(); // 252
    expect(validateEmail(`${"a".repeat(250)}@ex.com`)?.message).toMatch(/too long/i);
  });

  it("rejects shapes that are not vaguely email-like", () => {
    for (const bad of ["ada", "ada@", "@example.com", "ada@example", "a b@example.com", "ada@ex ample.com"]) {
      expect(validateEmail(bad)?.message, bad).toMatch(/valid email/i);
    }
  });

  it("reports the field name so the route can build a fieldErrors map", () => {
    expect(validateEmail("nope")?.field).toBe("email");
  });
});

describe("validateName", () => {
  it("accepts an ordinary name", () => {
    expect(validateName("Ada", "firstName")).toBeNull();
  });

  it("requires a value, and names the right field in the message", () => {
    expect(validateName("  ", "firstName")?.message).toBe("First name is required.");
    expect(validateName("", "lastName")?.message).toBe("Last name is required.");
  });

  it("caps length at 60", () => {
    expect(validateName("a".repeat(60), "firstName")).toBeNull();
    expect(validateName("a".repeat(61), "firstName")?.message).toMatch(/Maximum 60/);
  });

  it("counts the trimmed length, not the raw one", () => {
    expect(validateName(`  ${"a".repeat(60)}  `, "lastName")).toBeNull();
  });

  it("echoes back the field it was asked about", () => {
    expect(validateName("", "lastName")?.field).toBe("lastName");
  });
});

describe("parseRegisterBody", () => {
  const valid = { firstName: "Ada", lastName: "Lovelace", email: "a@b.com", password: "correct horse" };

  it("returns the four fields from a well-formed body", () => {
    expect(parseRegisterBody(valid)).toEqual(valid);
  });

  it("drops unknown keys rather than passing them through", () => {
    expect(parseRegisterBody({ ...valid, isAdmin: true })).toEqual(valid);
  });

  // Shape checking only: it does not trim or validate. The route calls the
  // validators separately, and conflating the two would hide which step failed.
  it("does not trim or validate, only shape-check", () => {
    const untrimmed = { ...valid, firstName: "  Ada  ", email: "NOT AN EMAIL" };
    expect(parseRegisterBody(untrimmed)).toEqual(untrimmed);
  });

  it("returns null for anything that is not an object with four strings", () => {
    for (const bad of [null, undefined, "x", 42, [], {}, { ...valid, password: 1 }, { ...valid, email: null }]) {
      expect(parseRegisterBody(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("parseLoginBody", () => {
  it("returns email and password from a well-formed body", () => {
    expect(parseLoginBody({ email: "a@b.com", password: "pw" })).toEqual({
      email: "a@b.com",
      password: "pw",
    });
  });

  it("drops unknown keys", () => {
    expect(parseLoginBody({ email: "a@b.com", password: "pw", next: "/admin" })).toEqual({
      email: "a@b.com",
      password: "pw",
    });
  });

  it("returns null for anything else", () => {
    for (const bad of [null, undefined, {}, { email: "a@b.com" }, { password: "pw" }, { email: 1, password: "pw" }]) {
      expect(parseLoginBody(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  // An empty string is a valid *shape*. Rejecting it is the validators' job,
  // and login deliberately runs a dummy Argon2 verify on a miss to keep
  // response times uniform — so an empty password must reach that path rather
  // than short-circuit here.
  it("accepts empty strings, leaving the credential check to the caller", () => {
    expect(parseLoginBody({ email: "", password: "" })).toEqual({ email: "", password: "" });
  });
});
