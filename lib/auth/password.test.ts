import { describe, it, expect } from "vitest";
import {
  validatePasswordRules,
  hashPassword,
  verifyPassword,
  getDummyHash,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
} from "./password";

describe("validatePasswordRules", () => {
  it("rejects passwords shorter than the minimum length", () => {
    const result = validatePasswordRules("short");
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain(`at least ${PASSWORD_MIN_LENGTH}`);
  });

  it("rejects passwords longer than the maximum length", () => {
    const result = validatePasswordRules("x".repeat(PASSWORD_MAX_LENGTH + 1));
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain(`at most ${PASSWORD_MAX_LENGTH}`);
  });

  it("accepts a password exactly at the minimum length", () => {
    const result = validatePasswordRules("x".repeat(PASSWORD_MIN_LENGTH));
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("accepts a password exactly at the maximum length", () => {
    const result = validatePasswordRules("x".repeat(PASSWORD_MAX_LENGTH));
    expect(result.ok).toBe(true);
  });
});

describe("hashPassword + verifyPassword", () => {
  // Argon2 with m=64MB,t=3,p=4 is intentionally slow. Bump timeout.
  it("round-trips a password through hash and verify", { timeout: 15_000 }, async () => {
    const plaintext = "correct horse battery staple";
    const hashed = await hashPassword(plaintext);
    expect(hashed).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(plaintext, hashed)).toBe(true);
  });

  it("rejects a tampered password against a real hash", { timeout: 15_000 }, async () => {
    const hashed = await hashPassword("genuine password 123!");
    expect(await verifyPassword("genuine password 124!", hashed)).toBe(false);
  });

  it("returns false (no throw) when the stored hash is malformed", async () => {
    expect(await verifyPassword("anything", "not-a-real-argon2-hash")).toBe(false);
  });
});

describe("getDummyHash", () => {
  it("returns a stable, parseable Argon2id hash that fails to verify against any plaintext", { timeout: 15_000 }, async () => {
    const dummy1 = await getDummyHash();
    const dummy2 = await getDummyHash();
    expect(dummy1).toBe(dummy2);
    expect(dummy1).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword("any candidate at all", dummy1)).toBe(false);
  });
});
