import { describe, it, expect } from "vitest";
import { dateStringToUtcDate, utcDateToDateString } from "./date-utils";

// These lived identically in lib/transactions.ts and lib/accounts.ts. Both
// copies carried the same reasoning: the columns they feed are `@db.Date`
// (no time component), and `new Date(y, m, d)` builds local midnight, which
// lands on the previous calendar day in any negative-UTC-offset timezone.
describe("dateStringToUtcDate", () => {
  it("builds UTC midnight for the named calendar day", () => {
    const d = dateStringToUtcDate("2026-02-14");
    expect(d.toISOString()).toBe("2026-02-14T00:00:00.000Z");
  });

  it("does not shift the day, whatever the host timezone offset", () => {
    // The whole point: the UTC calendar day must equal the string's day.
    for (const s of ["2026-01-01", "2026-06-30", "2026-12-31", "2024-02-29"]) {
      const d = dateStringToUtcDate(s);
      expect(d.getUTCFullYear()).toBe(Number(s.slice(0, 4)));
      expect(d.getUTCMonth() + 1).toBe(Number(s.slice(5, 7)));
      expect(d.getUTCDate()).toBe(Number(s.slice(8, 10)));
    }
  });

  it("handles a leap day", () => {
    expect(dateStringToUtcDate("2024-02-29").toISOString()).toBe("2024-02-29T00:00:00.000Z");
  });
});

describe("utcDateToDateString", () => {
  it("renders the UTC calendar day as YYYY-MM-DD", () => {
    expect(utcDateToDateString(new Date("2026-02-14T00:00:00.000Z"))).toBe("2026-02-14");
  });

  it("reads the UTC day even when the instant is late in the UTC day", () => {
    expect(utcDateToDateString(new Date("2026-02-14T23:59:59.999Z"))).toBe("2026-02-14");
  });
});

describe("round trip", () => {
  it("is lossless for a calendar day", () => {
    for (const s of ["2026-01-01", "2026-02-14", "2026-12-31", "2024-02-29"]) {
      expect(utcDateToDateString(dateStringToUtcDate(s))).toBe(s);
    }
  });
});
