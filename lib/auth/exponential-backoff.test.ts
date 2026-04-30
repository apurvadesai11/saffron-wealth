import { describe, it, expect } from "vitest";
import { delayForFailureCount } from "./exponential-backoff";

describe("delayForFailureCount", () => {
  it("returns 0 for zero or negative failures", () => {
    expect(delayForFailureCount(0)).toBe(0);
    expect(delayForFailureCount(-5)).toBe(0);
  });

  it("ramps 1, 2, 4, 8, 16, 32 for failures 1..6", () => {
    expect(delayForFailureCount(1)).toBe(1);
    expect(delayForFailureCount(2)).toBe(2);
    expect(delayForFailureCount(3)).toBe(4);
    expect(delayForFailureCount(4)).toBe(8);
    expect(delayForFailureCount(5)).toBe(16);
    expect(delayForFailureCount(6)).toBe(32);
  });

  it("caps at 60 seconds for high failure counts", () => {
    expect(delayForFailureCount(7)).toBe(60);
    expect(delayForFailureCount(50)).toBe(60);
    expect(delayForFailureCount(1_000_000)).toBe(60);
  });
});
