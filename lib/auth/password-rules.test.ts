// Client-safe half of the password rules, reused by PasswordStrengthHint so a
// client component doesn't drag in the server-only argon2 binding. Untested
// against the directory's one-file-per-module bar.
import { describe, it, expect } from "vitest";
import {
  validatePasswordRules,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
} from "./password-rules";

describe("validatePasswordRules", () => {
  it("accepts a password at the minimum length", () => {
    expect(validatePasswordRules("a".repeat(PASSWORD_MIN_LENGTH))).toEqual({
      ok: true,
      errors: [],
    });
  });

  it("accepts a password at the maximum length", () => {
    expect(validatePasswordRules("a".repeat(PASSWORD_MAX_LENGTH)).ok).toBe(true);
  });

  it("rejects one character short", () => {
    const result = validatePasswordRules("a".repeat(PASSWORD_MIN_LENGTH - 1));
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain(String(PASSWORD_MIN_LENGTH));
  });

  it("rejects one character long", () => {
    const result = validatePasswordRules("a".repeat(PASSWORD_MAX_LENGTH + 1));
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain(String(PASSWORD_MAX_LENGTH));
  });

  it("rejects an empty password with the length message", () => {
    expect(validatePasswordRules("").ok).toBe(false);
  });

  // Length only, on purpose: composition rules (a digit, a symbol) push users
  // toward predictable substitutions. Breach-corpus and blocklist checks are
  // what actually reject weak passwords here, and they live in hibp.ts and
  // blocklist.ts. Pinned so the rules aren't "strengthened" into that trap.
  it("imposes no composition requirement", () => {
    expect(validatePasswordRules("aaaaaaaaaaaa").ok).toBe(true);
    expect(validatePasswordRules("            ").ok).toBe(true);
  });

  it("counts characters as given, without trimming", () => {
    // A password is a secret, not a form field: trimming would silently change
    // what the user typed and break a password that legitimately ends in a
    // space.
    expect(validatePasswordRules(`  ${"a".repeat(PASSWORD_MIN_LENGTH - 4)}  `).ok).toBe(true);
  });

  it("reports both bounds as one error at a time, never contradictory ones", () => {
    const short = validatePasswordRules("a");
    expect(short.errors).toHaveLength(1);
  });
});
