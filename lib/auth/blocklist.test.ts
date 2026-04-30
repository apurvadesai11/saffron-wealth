import { describe, it, expect } from "vitest";
import { isCommonPassword, blocklistSize } from "./blocklist";

describe("isCommonPassword", () => {
  it("flags well-known weak passwords", () => {
    expect(isCommonPassword("password")).toBe(true);
    expect(isCommonPassword("123456")).toBe(true);
    expect(isCommonPassword("qwerty")).toBe(true);
    expect(isCommonPassword("letmein")).toBe(true);
    expect(isCommonPassword("admin")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isCommonPassword("PASSWORD")).toBe(true);
    expect(isCommonPassword("Password")).toBe(true);
    expect(isCommonPassword("PaSsWoRd")).toBe(true);
  });

  it("does not flag a strong unique passphrase", () => {
    expect(isCommonPassword("correct horse battery staple")).toBe(false);
    expect(isCommonPassword("k7@vQpL!9zXrM2nW")).toBe(false);
  });

  it("flags the saffron-specific entries we care about", () => {
    expect(isCommonPassword("saffron")).toBe(true);
    expect(isCommonPassword("saffronwealth")).toBe(true);
  });

  it("the bundled set is non-empty", () => {
    expect(blocklistSize()).toBeGreaterThan(100);
  });
});
