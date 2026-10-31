import { describe, it, expect } from "vitest";
import { formatUsd, roundToCent } from "./money";

describe("formatUsd", () => {
  it.each([
    [0, "$0.00"],
    [7.5, "$7.50"],
    [999.99, "$999.99"],
    [1000, "$1,000.00"],
    [1234567.891, "$1,234,567.89"],
    [-1234.5, "-$1,234.50"],
  ])("formats %d as %s", (value, want) => {
    expect(formatUsd(value)).toBe(want);
  });

  // A total that is really zero must never read as a debt. Float dust and
  // Math.round(-0.001 * 100) both produce -0, which Intl would render as
  // "-$0.00" without the sign rule.
  it.each([
    [-0, "$0.00"],
    [-0.001, "$0.00"],
    [roundToCent(0.3 - 0.1 - 0.2), "$0.00"],
  ])("renders the zero-valued %d without a minus sign", (value, want) => {
    expect(formatUsd(value)).toBe(want);
  });

  describe("wholeDollars", () => {
    it.each([
      [0, "$0"],
      [80, "$80"],
      [1234.4, "$1,234"],
      [1234.6, "$1,235"],
      [-25000, "-$25,000"],
      [-0.4, "$0"],
    ])("formats %d as %s", (value, want) => {
      expect(formatUsd(value, { wholeDollars: true })).toBe(want);
    });
  });
});
