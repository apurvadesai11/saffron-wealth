import { describe, it, expect } from "vitest";
import { generateOauthState, validateOauthState } from "./oauth-state";

describe("generateOauthState", () => {
  it("returns base64url tokens of consistent length", () => {
    const a = generateOauthState();
    const b = generateOauthState();
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(b).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a).not.toBe(b);
    expect(a.length).toBe(b.length);
    expect(a.length).toBeGreaterThanOrEqual(40);
  });
});

describe("validateOauthState", () => {
  it("rejects when cookie is missing", () => {
    expect(validateOauthState(undefined, "abc123")).toBe(false);
  });

  it("rejects when query param is missing", () => {
    expect(validateOauthState("abc123", null)).toBe(false);
  });

  it("rejects when both are missing", () => {
    expect(validateOauthState(undefined, null)).toBe(false);
  });

  it("rejects when lengths differ (cheap pre-check)", () => {
    expect(validateOauthState("short", "muchlongerstate")).toBe(false);
  });

  it("rejects when same length but different value", () => {
    expect(validateOauthState("abc123def456", "xyz789jkl012")).toBe(false);
  });

  it("accepts when values match exactly", () => {
    const token = generateOauthState();
    expect(validateOauthState(token, token)).toBe(true);
  });
});
