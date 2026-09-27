import { describe, it, expect } from "vitest";
import { computeNetWorthSeries } from "./net-worth-history";
import type { AccountType } from "./types";

// Minimal event fixture — computeNetWorthSeries only reads these four fields.
function ev(
  accountId: string,
  asOf: string,
  balance: number,
  recordedAt: string = `${asOf}T00:00:00.000Z`,
) {
  return { accountId, asOf, balance, recordedAt };
}

// archivedAt defaults to null (active) since most fixtures don't care about
// the amendment — only the tests that specifically need a closed window pass
// a non-null value explicitly.
function acct(id: string, type: AccountType, archivedAt: string | null = null) {
  return { id, type, archivedAt };
}

describe("computeNetWorthSeries", () => {
  it("returns [] for an empty event list", () => {
    expect(computeNetWorthSeries([], [])).toEqual([]);
    // Even with accounts on the roster but no history at all.
    expect(computeNetWorthSeries([], [acct("a", "cash")])).toEqual([]);
  });

  it("returns one point for a single event", () => {
    const points = computeNetWorthSeries(
      [ev("a", "2026-01-01", 1000)],
      [acct("a", "cash")],
    );
    expect(points).toEqual([{ date: "2026-01-01", value: 1000 }]);
  });

  it("carries a balance forward inside the window when another account samples a date in between", () => {
    const points = computeNetWorthSeries(
      [
        ev("a", "2026-01-01", 100),
        ev("a", "2026-03-01", 200),
        // b's sample date falls strictly between a's two events; a has no
        // event of its own on that date, so carry-forward must supply 100
        // (the most recent a-event <= 2026-02-01), not 0 and not 200.
        ev("b", "2026-02-01", 5000),
      ],
      [acct("a", "cash"), acct("b", "cash")],
    );
    const mid = points.find((p) => p.date === "2026-02-01");
    expect(mid?.value).toBe(100 + 5000);
  });

  it("Ruling 3: an ARCHIVED closed account contributes nothing to a later date, even with a large non-zero final balance", () => {
    // Mirrors the real scenario: a mortgage that stops reporting (paid off /
    // account closed and archived by Task 5's import) while still frozen at
    // a large balance, per the debt storage convention (stored = -raw, so an
    // owed $450k mortgage is stored as +450000).
    const points = computeNetWorthSeries(
      [
        ev("mortgage", "2026-01-01", 450000),
        // No further mortgage events — it closed here.
        ev("checking", "2026-01-01", 1000),
        ev("checking", "2026-06-01", 1000),
      ],
      [
        acct("mortgage", "loan_mortgage", "2026-01-02T00:00:00.000Z"), // archived
        acct("checking", "cash"), // active
      ],
    );
    const later = points.find((p) => p.date === "2026-06-01");
    // A naive "most recent event <= D" with no upper bound at all — i.e. one
    // that ignores archivedAt entirely — would carry -450000 (the mortgage's
    // signed contribution) into this date regardless of archived state.
    // Correct behavior: an archived account's window closes at lastDate, so
    // the mortgage contributes exactly 0 here, leaving just the checking
    // balance. This still fails against that unbounded-carry-forward bug.
    expect(later?.value).toBe(1000);
  });

  it("contributes zero before an account's firstDate", () => {
    const points = computeNetWorthSeries(
      [ev("late", "2026-05-01", 9999), ev("early", "2026-01-01", 100)],
      [acct("late", "cash"), acct("early", "cash")],
    );
    const first = points.find((p) => p.date === "2026-01-01");
    expect(first?.value).toBe(100); // "late" hasn't opened yet — contributes 0
  });

  it("handles an account appearing partway through the series", () => {
    const points = computeNetWorthSeries(
      [
        ev("steady", "2026-01-01", 1000),
        ev("steady", "2026-02-01", 1000),
        ev("steady", "2026-03-01", 1000),
        ev("steady", "2026-04-01", 1000),
        // "newcomer" only starts contributing from March onward.
        ev("newcomer", "2026-03-01", 500),
        ev("newcomer", "2026-04-01", 600),
      ],
      [acct("steady", "cash"), acct("newcomer", "cash")],
    );
    const byDate = new Map(points.map((p) => [p.date, p.value]));
    expect(byDate.get("2026-01-01")).toBe(1000);
    expect(byDate.get("2026-02-01")).toBe(1000);
    expect(byDate.get("2026-03-01")).toBe(1000 + 500);
    expect(byDate.get("2026-04-01")).toBe(1000 + 600);
  });

  it("subtracts a debt account's signed contribution", () => {
    const points = computeNetWorthSeries(
      [ev("cash1", "2026-01-01", 1000), ev("card", "2026-01-01", 300)],
      [acct("cash1", "cash"), acct("card", "credit_card")],
    );
    // 300 stored on a credit_card is "$300 owed" — it must subtract, not add.
    expect(points).toEqual([{ date: "2026-01-01", value: 700 }]);
  });

  it("raises net worth when an ARCHIVED debt account closes, even with the asset side unchanged", () => {
    const points = computeNetWorthSeries(
      [
        ev("cash1", "2026-01-01", 1000),
        ev("cash1", "2026-02-01", 1000), // unchanged
        // Debt account's only event — its window is exactly this one date,
        // and it's archived, so the window actually closes there.
        ev("card", "2026-01-01", 500),
      ],
      [acct("cash1", "cash"), acct("card", "credit_card", "2026-01-02T00:00:00.000Z")],
    );
    const byDate = new Map(points.map((p) => [p.date, p.value]));
    expect(byDate.get("2026-01-01")).toBe(1000 - 500); // debt active window: 500
    expect(byDate.get("2026-02-01")).toBe(1000); // debt archived+closed: dropped, not carried
  });

  it("keeps two accounts with disjoint windows from contributing outside their own range", () => {
    const points = computeNetWorthSeries(
      [
        ev("jan", "2026-01-01", 100),
        ev("jan", "2026-01-15", 150),
        ev("mar", "2026-03-01", 900),
        ev("mar", "2026-03-15", 950),
      ],
      [
        // "jan" must be archived, or per the amendment it would carry its
        // last balance (150) forward into March as an active account would.
        acct("jan", "cash", "2026-01-16T00:00:00.000Z"),
        acct("mar", "cash"),
      ],
    );
    const byDate = new Map(points.map((p) => [p.date, p.value]));
    // Only "jan" is alive in January — "mar" hasn't opened yet.
    expect(byDate.get("2026-01-01")).toBe(100);
    expect(byDate.get("2026-01-15")).toBe(150);
    // Only "mar" is alive in March — "jan" has already closed (archived).
    expect(byDate.get("2026-03-01")).toBe(900);
    expect(byDate.get("2026-03-15")).toBe(950);
  });

  it("returns a sorted, deduplicated union of sample dates even when per-account processing order is non-monotonic", () => {
    const points = computeNetWorthSeries(
      [
        // "a" is the first accountId encountered (its first event appears
        // first below), and its own two dates straddle "b"'s single date.
        // Per-account event lists are sorted individually before being added
        // to the sample-date set, so the set's natural INSERTION order
        // (before the final union .sort()) becomes 01-01, 03-01, 02-01 — not
        // ascending. A fixture where the first-seen account's dates happen
        // to already be globally ascending would let a missing `.sort()`
        // slip through undetected; this one doesn't.
        ev("a", "2026-01-01", 10),
        ev("a", "2026-03-01", 30),
        ev("b", "2026-02-01", 20),
      ],
      [
        // Archived so behavior is fully pinned by firstDate/lastDate alone,
        // independent of the active-carry-forward amendment tested elsewhere.
        acct("a", "cash", "2026-04-01T00:00:00.000Z"),
        acct("b", "cash", "2026-04-01T00:00:00.000Z"),
      ],
    );

    // Exact ordered equality catches a missing/broken sort directly (unlike
    // a pairwise "each > previous" check, which this same fixture's
    // predecessor passed by coincidence even with .sort() deleted).
    expect(points.map((p) => p.date)).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);

    // Values, not just order: without the final sort, dates are swept in
    // insertion order (01-01, 03-01, 02-01). Because the per-account cursor
    // never rewinds, sweeping 03-01 before 02-01 leaves "a"'s cursor already
    // advanced past 02-01 when 02-01 is finally (out-of-turn) processed —
    // reporting a's later balance (30) instead of the correct one (10), so
    // 2026-02-01 comes out as 50 instead of 30.
    const byDate = new Map(points.map((p) => [p.date, p.value]));
    expect(byDate.get("2026-01-01")).toBe(10); // only "a": 10
    expect(byDate.get("2026-02-01")).toBe(30); // "a" carries 10 + "b" opens at 20
    expect(byDate.get("2026-03-01")).toBe(30); // "a" updates to 30; "b" already closed (archived)
  });

  it("Ruling 9: two events sharing one asOf resolve to the later recordedAt, not the first-encountered one", () => {
    const points = computeNetWorthSeries(
      [
        // Same-day double-edit: user set the balance to 100, then to 200
        // later the same day. Input order is deliberately reversed (later
        // recordedAt listed first) to prove the result depends on
        // recordedAt ordering, not array/insertion order.
        ev("a", "2026-01-01", 200, "2026-01-01T15:00:00.000Z"),
        ev("a", "2026-01-01", 100, "2026-01-01T09:00:00.000Z"),
      ],
      [acct("a", "cash")],
    );
    // Must be 200 (the later write), and there must be exactly one point for
    // this date — the two same-day events collapse to one sample, not a sum
    // (300) and not two separate points.
    expect(points).toEqual([{ date: "2026-01-01", value: 200 }]);
  });

  it("rounds a float-dust total that lands exactly on zero to +0, not -0", () => {
    // 0.3 - 0.1 - 0.2 is a canonical binary-float example that lands on a
    // tiny NEGATIVE number instead of exactly 0 (-2.7755575615628914e-17).
    // Math.round of that, scaled to cents, produces -0, which fails
    // Object.is(_, 0) / toBe(0) and would render as "-$0.00".
    const points = computeNetWorthSeries(
      [
        ev("asset", "2026-01-01", 0.3),
        ev("debt1", "2026-01-01", 0.1),
        ev("debt2", "2026-01-01", 0.2),
      ],
      [
        acct("asset", "cash"),
        acct("debt1", "credit_card"),
        acct("debt2", "credit_card"),
      ],
    );
    expect(points).toHaveLength(1);
    // Object.is, not just toBe, so this can't silently pass with -0.
    expect(Object.is(points[0].value, 0)).toBe(true);
  });

  it("drops an event whose accountId isn't in the account roster, contributing nothing and adding no sample date", () => {
    const points = computeNetWorthSeries(
      [
        // "ghost" has no matching entry in `accounts` below — its type (and
        // therefore asset/liability sign) is unresolvable.
        ev("ghost", "2026-05-01", 999999),
        ev("a", "2026-01-01", 100),
      ],
      [acct("a", "cash")],
    );
    // Not just "ghost's value is excluded" — its date shouldn't appear as a
    // sample point at all.
    expect(points).toEqual([{ date: "2026-01-01", value: 100 }]);
  });

  it("ignores a roster account that has zero events, without crashing or affecting other accounts", () => {
    const points = computeNetWorthSeries(
      [ev("a", "2026-01-01", 100)],
      [acct("empty", "cash"), acct("a", "cash")],
    );
    expect(points).toEqual([{ date: "2026-01-01", value: 100 }]);
  });

  describe("archivedAt window semantics (Ruling 3, amended)", () => {
    // Each case below isolates one cell of the archived x before/after-window
    // matrix, using a second single-event "anchor" account purely to create
    // a sample date at the point of interest (computeNetWorthSeries only
    // samples dates that some account actually has an event on).

    it("archived + date after lastDate -> 0", () => {
      const points = computeNetWorthSeries(
        [
          ev("x", "2026-01-01", 100),
          ev("x", "2026-02-01", 200),
          ev("anchor", "2026-03-01", 0),
        ],
        [acct("x", "cash", "2026-02-15T00:00:00.000Z"), acct("anchor", "cash")],
      );
      expect(points.find((p) => p.date === "2026-03-01")?.value).toBe(0);
    });

    it("active + date after lastDate -> carries forward (the amendment)", () => {
      const points = computeNetWorthSeries(
        [
          ev("x", "2026-01-01", 100),
          ev("x", "2026-02-01", 200),
          ev("anchor", "2026-03-01", 0),
        ],
        [acct("x", "cash", null), acct("anchor", "cash")],
      );
      // Pre-amendment behavior (unconditional close at lastDate) would give
      // 0 here — this is exactly the hand-entered-account defect the
      // amendment fixes.
      expect(points.find((p) => p.date === "2026-03-01")?.value).toBe(200);
    });

    it("archived + date inside window -> carries forward as normal", () => {
      const points = computeNetWorthSeries(
        [
          ev("x", "2026-01-01", 100),
          ev("x", "2026-03-01", 300),
          ev("anchor", "2026-02-01", 0),
        ],
        [acct("x", "cash", "2026-04-01T00:00:00.000Z"), acct("anchor", "cash")],
      );
      // Archiving must not suppress ordinary in-window carry-forward.
      expect(points.find((p) => p.date === "2026-02-01")?.value).toBe(100);
    });

    // Task 8 review finding: archiveAccount (lib/accounts.ts) never writes a
    // closing AccountBalanceEvent, so an account created and archived on the
    // SAME calendar day has lastDate === its own archive date. Pre-fix,
    // "date > lastDate" alone doesn't exclude that day (equal isn't
    // greater), so the series would still count it on the very day the live
    // summary card (computeNetWorth, via listAccounts) already excludes it
    // unconditionally — a full-balance mismatch between the chart and the
    // summary card, not the documented one-cent/overpaid-debt caveat.
    it("an account archived the SAME day it was created contributes nothing on that day", () => {
      const points = computeNetWorthSeries(
        [ev("sameDay", "2026-01-01", 500)],
        // Archived later the same calendar day (different time, same date).
        [acct("sameDay", "cash", "2026-01-01T18:00:00.000Z")],
      );
      expect(points).toEqual([{ date: "2026-01-01", value: 0 }]);
    });

    it("date before firstDate -> 0 regardless of archived state", () => {
      const points = computeNetWorthSeries(
        [
          ev("archivedLater", "2026-05-01", 999),
          ev("activeLater", "2026-05-01", 888),
          ev("anchor", "2026-01-01", 0),
        ],
        [
          acct("archivedLater", "cash", "2026-06-01T00:00:00.000Z"),
          acct("activeLater", "cash", null),
          acct("anchor", "cash"),
        ],
      );
      // Neither account has opened yet as of 2026-01-01 — the lower bound
      // applies unconditionally, unaffected by archived status either way.
      expect(points.find((p) => p.date === "2026-01-01")?.value).toBe(0);
    });
  });
});
