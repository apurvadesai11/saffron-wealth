// DB-backed tests for the net-worth-over-time series query functions
// (Phase 3, Task 8). Unlike the rest of lib/accounts.ts, these two have no
// API route wrapping them to test through (the series is computed directly
// inside app/(app)/net-worth/page.tsx's RSC body, not behind an endpoint),
// so they get their own file here rather than living in
// app/api/accounts/__tests__/.
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "./prisma";
import { listAccounts, listAccountsForSeries, listBalanceEventsForSeries } from "./accounts";
import { computeNetWorthSeries } from "./net-worth-history";

let userId: string | undefined;

afterEach(async () => {
  if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  userId = undefined;
});

async function seedUser() {
  const email = `accounts-series-test-${randomUUID()}@example.test`;
  const user = await prisma.user.create({
    data: { email, emailNormalized: email.toLowerCase(), firstName: "Series", lastName: "Test" },
  });
  userId = user.id;
  return user;
}

describe("listAccountsForSeries", () => {
  it("includes archived accounts, unlike listAccounts", async () => {
    const user = await seedUser();
    const active = await prisma.account.create({
      data: { userId: user.id, name: "Active Cash", type: "cash", balance: 100 },
    });
    const archivedAt = new Date("2026-01-02T00:00:00.000Z");
    const archived = await prisma.account.create({
      data: { userId: user.id, name: "Closed Brokerage", type: "brokerage", balance: 5200, archivedAt },
    });

    const roster = await listAccountsForSeries(user.id);
    const rosterIds = roster.map((r) => r.id);
    expect(rosterIds).toContain(active.id);
    // The whole point of this function existing: an archived account must
    // still be in the roster the series is computed against.
    expect(rosterIds).toContain(archived.id);

    const archivedEntry = roster.find((r) => r.id === archived.id)!;
    expect(archivedEntry.type).toBe("brokerage");
    expect(archivedEntry.archivedAt).toBe(archivedAt.toISOString());

    const activeEntry = roster.find((r) => r.id === active.id)!;
    expect(activeEntry.archivedAt).toBeNull();

    // listAccounts (the function the summary cards use) is the WRONG one
    // for the series precisely because it excludes this same archived row.
    const activeOnly = await listAccounts(user.id);
    expect(activeOnly.map((a) => a.id)).not.toContain(archived.id);
  });
});

describe("listBalanceEventsForSeries", () => {
  it("returns accountId/asOf/balance/recordedAt with balance as a number and asOf as a plain date string", async () => {
    const user = await seedUser();
    const account = await prisma.account.create({
      data: { userId: user.id, name: "Checking", type: "cash", balance: 1200 },
    });
    // Drop createAccount's auto opening-balance event so this test's
    // expectation is exact, not "at least this one plus an extra."
    await prisma.accountBalanceEvent.deleteMany({ where: { accountId: account.id } });
    await prisma.accountBalanceEvent.create({
      data: {
        userId: user.id,
        accountId: account.id,
        balance: 1200,
        asOf: new Date("2026-01-03T00:00:00.000Z"),
      },
    });

    const events = await listBalanceEventsForSeries(user.id);
    expect(events).toEqual([
      {
        accountId: account.id,
        asOf: "2026-01-03",
        balance: 1200,
        recordedAt: expect.any(String),
      },
    ]);
    // Decimal -> number, not the Prisma.Decimal object (which would
    // serialize to a JSON string and silently break arithmetic downstream).
    expect(typeof events[0].balance).toBe("number");
  });
});

describe("the archived-roster bug this two-query split exists to prevent", () => {
  it("an archived account's PAST contribution survives in the series when fed the correct roster, and would vanish from that same past point if listAccounts were used instead", async () => {
    const user = await seedUser();
    // Mirrors app/api/accounts/__tests__/fixtures/balance-history-sample.csv's
    // "Legacy Brokerage" shape: closes one day before the other account's
    // last date, so it ends up archived while still holding real history
    // for the days it was genuinely open.
    const checking = await prisma.account.create({
      data: { userId: user.id, name: "Checking", type: "cash", balance: 1200 },
    });
    const brokerage = await prisma.account.create({
      data: {
        userId: user.id,
        name: "Legacy Brokerage",
        type: "brokerage",
        balance: 5200,
        archivedAt: new Date("2026-01-03T00:00:00.000Z"),
      },
    });
    // Replace both accounts' auto opening-balance events with an exact,
    // hand-specified history so the expected sums below are unambiguous.
    await prisma.accountBalanceEvent.deleteMany({ where: { userId: user.id } });
    await prisma.accountBalanceEvent.createMany({
      data: [
        { userId: user.id, accountId: checking.id, balance: -50, asOf: new Date("2026-01-01T00:00:00.000Z") },
        { userId: user.id, accountId: checking.id, balance: 1200, asOf: new Date("2026-01-03T00:00:00.000Z") },
        { userId: user.id, accountId: brokerage.id, balance: 5000, asOf: new Date("2026-01-01T00:00:00.000Z") },
        // Brokerage's last event is 01-02 — one day before Checking's, and
        // before archivedAt — matching the fixture's "closes early" shape.
        { userId: user.id, accountId: brokerage.id, balance: 5200, asOf: new Date("2026-01-02T00:00:00.000Z") },
      ],
    });

    const events = await listBalanceEventsForSeries(user.id);

    const correctRoster = await listAccountsForSeries(user.id);
    const correctSeries = computeNetWorthSeries(events, correctRoster);
    const correctFirstPoint = correctSeries.find((p) => p.date === "2026-01-01")!;
    // -50 (checking) + 5000 (brokerage — still open on this early date).
    expect(correctFirstPoint.value).toBe(4950);

    // The bug this test exists to catch: swap in listAccounts (which
    // excludes the archived row entirely — Legacy Brokerage isn't just
    // marked non-archived, it's simply absent) as the roster and re-run the
    // exact same pure function on the exact same events. The mapping below
    // is exactly what a caller wiring listAccounts into the series would
    // produce (every returned row is, by construction, non-archived).
    // computeNetWorthSeries's "no roster entry" guard silently drops every
    // event for an account missing from the roster, erasing Legacy
    // Brokerage's contribution from this EARLY point too — not just from
    // "today" — which is precisely the regression the task brief warns
    // about.
    const wrongRoster = (await listAccounts(user.id)).map((a) => ({
      id: a.id,
      type: a.type,
      archivedAt: null as string | null,
    }));
    const buggySeries = computeNetWorthSeries(events, wrongRoster);
    const buggyFirstPoint = buggySeries.find((p) => p.date === "2026-01-01")!;
    expect(buggyFirstPoint.value).toBe(-50);
    expect(buggyFirstPoint.value).not.toBe(correctFirstPoint.value);
  });
});
