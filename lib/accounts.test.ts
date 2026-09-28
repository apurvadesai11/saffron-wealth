// DB-backed tests for the net-worth-over-time series query functions
// . Unlike the rest of lib/accounts.ts, these two have no
// API route wrapping them to test through (the series is computed directly
// inside app/(app)/net-worth/page.tsx's RSC body, not behind an endpoint),
// so they get their own file here rather than living in
// app/api/accounts/__tests__/.
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "./prisma";
import {
  createAccount,
  listAccounts,
  listAccountsForSeries,
  listBalanceEventsForSeries,
  updateAccount,
  upsertAccountsFromBalanceHistory,
} from "./accounts";
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

// AccountBalanceEvent.balance stores the account's signed contribution to net
// worth (see the sign-convention note in lib/net-worth-history.ts), so the
// bucket is applied once here at write time rather than at every read.
describe("balance event sign at write time", () => {
  async function eventsFor(accountId: string) {
    const rows = await prisma.accountBalanceEvent.findMany({
      where: { accountId },
      orderBy: { recordedAt: "asc" },
    });
    return rows.map((r) => r.balance.toNumber());
  }

  it("writes an asset's opening balance as a positive contribution", async () => {
    const user = await seedUser();
    const account = await createAccount(user.id, {
      name: "Checking",
      type: "cash",
      institution: null,
      balance: 1000,
    });

    expect(await eventsFor(account.id)).toEqual([1000]);
  });

  it("writes a debt's opening balance as a negative contribution", async () => {
    const user = await seedUser();
    const account = await createAccount(user.id, {
      name: "Card",
      type: "credit_card",
      institution: null,
      balance: 300, // $300 owed
    });

    expect(await eventsFor(account.id)).toEqual([-300]);
  });

  it("writes a debt balance edit as a negative contribution", async () => {
    const user = await seedUser();
    const account = await createAccount(user.id, {
      name: "Card",
      type: "credit_card",
      institution: null,
      balance: 300,
    });

    await updateAccount(user.id, account.id, { balance: 450 });

    expect(await eventsFor(account.id)).toEqual([-300, -450]);
  });

  // An explicit user correction — "this was always a loan, not a property" —
  // is the one thing that SHOULD reinterpret history. Doing it here, once, as
  // a write keeps read-time interpretation type-independent while still
  // letting a mistype be fixed.
  it("re-signs existing events when the type crosses from asset to debt", async () => {
    const user = await seedUser();
    const account = await createAccount(user.id, {
      name: "Mistyped loan",
      type: "property",
      institution: null,
      balance: 450000,
    });

    await updateAccount(user.id, account.id, { type: "loan_mortgage" });

    expect(await eventsFor(account.id)).toEqual([-450000]);
  });

  it("re-signs existing events when the type crosses from debt to asset", async () => {
    const user = await seedUser();
    const account = await createAccount(user.id, {
      name: "Mistyped asset",
      type: "credit_card",
      institution: null,
      balance: 5000,
    });

    await updateAccount(user.id, account.id, { type: "brokerage" });

    expect(await eventsFor(account.id)).toEqual([5000]);
  });

  it("leaves events alone when the type changes within the same side", async () => {
    const user = await seedUser();
    const account = await createAccount(user.id, {
      name: "Reclassified asset",
      type: "cash",
      institution: null,
      balance: 2500,
    });

    await updateAccount(user.id, account.id, { type: "brokerage" });

    expect(await eventsFor(account.id)).toEqual([2500]);
  });

  it("stores a credited card balance as an increase in net worth", async () => {
    const user = await seedUser();
    const account = await createAccount(user.id, {
      name: "Overpaid card",
      type: "credit_card",
      institution: null,
      balance: -500, // the bank owes the user $500
    });

    expect(await eventsFor(account.id)).toEqual([500]);
  });
});

// Replaces docs/decisions/0007-never-retype-an-existing-account.md ("an imported balance's sign overrides the stored type").
// That rule did not do what its rationale claimed: guessAccountType only
// consults the sign on its NEGATIVE branch, so a card-named account with a
// credited balance re-guessed straight back to credit_card and the override
// changed nothing. Where it did fire, it silently overwrote a type the user
// had deliberately set. The type is a stable property of the account; the
// sign belongs to the balance. The import now reports the disagreement and
// leaves the decision to the user.
describe("upsertAccountsFromBalanceHistory typing", () => {
  const FILE_MAX = "2026-03-01";

  it("keeps an existing account's stored type when the balance sign disagrees", async () => {
    const user = await seedUser();
    const account = await createAccount(user.id, {
      name: "Sunset Rewards",
      type: "credit_card",
      institution: null,
      balance: 0,
    });

    const [resolved] = await upsertAccountsFromBalanceHistory(
      user.id,
      [{ name: "Sunset Rewards", lastDate: FILE_MAX, finalBalanceSigned: 300 }],
      FILE_MAX,
      prisma,
      true,
    );

    expect(resolved.finalType).toBe("credit_card");
    const row = await prisma.account.findUnique({ where: { id: account.id } });
    expect(row?.type).toBe("credit_card");
  });

  it("reports the disagreement as a type conflict carrying the suggested type", async () => {
    const user = await seedUser();
    await createAccount(user.id, {
      name: "Old Brokerage",
      type: "brokerage",
      institution: null,
      balance: 0,
    });

    const [resolved] = await upsertAccountsFromBalanceHistory(
      user.id,
      [{ name: "Old Brokerage", lastDate: FILE_MAX, finalBalanceSigned: -800 }],
      FILE_MAX,
      prisma,
      true,
    );

    expect(resolved.typeConflict).toEqual({
      storedType: "brokerage",
      suggestedType: "credit_card",
    });
  });

  it("reports no conflict when the sign agrees with the stored bucket", async () => {
    const user = await seedUser();
    await createAccount(user.id, {
      name: "Everyday Checking",
      type: "cash",
      institution: null,
      balance: 0,
    });

    const [resolved] = await upsertAccountsFromBalanceHistory(
      user.id,
      [{ name: "Everyday Checking", lastDate: FILE_MAX, finalBalanceSigned: 1200 }],
      FILE_MAX,
      prisma,
      true,
    );

    expect(resolved.typeConflict).toBeUndefined();
  });

  it("still types a brand-new account from the balance sign", async () => {
    const user = await seedUser();

    const [resolved] = await upsertAccountsFromBalanceHistory(
      user.id,
      [{ name: "Unknown Account", lastDate: FILE_MAX, finalBalanceSigned: -500 }],
      FILE_MAX,
      prisma,
      true,
    );

    expect(resolved.finalType).toBe("credit_card");
    expect(resolved.typeConflict).toBeUndefined();
  });

  it("stores a credited card as a negative amount owed rather than its magnitude", async () => {
    const user = await seedUser();
    const account = await createAccount(user.id, {
      name: "Sample Credit Card",
      type: "credit_card",
      institution: null,
      balance: 0,
    });

    await upsertAccountsFromBalanceHistory(
      user.id,
      [{ name: "Sample Credit Card", lastDate: FILE_MAX, finalBalanceSigned: 500 }],
      FILE_MAX,
      prisma,
      true,
    );

    // Math.abs here read a $500 credit as $500 owed, a $1,000 swing against
    // the same account's contribution in the chart.
    const row = await prisma.account.findUnique({ where: { id: account.id } });
    expect(row?.balance.toNumber()).toBe(-500);
  });

  it("stores an overdrawn asset's negative balance rather than clamping it to zero", async () => {
    const user = await seedUser();
    const account = await createAccount(user.id, {
      name: "Everyday Checking",
      type: "cash",
      institution: null,
      balance: 0,
    });

    await upsertAccountsFromBalanceHistory(
      user.id,
      [{ name: "Everyday Checking", lastDate: FILE_MAX, finalBalanceSigned: -50 }],
      FILE_MAX,
      prisma,
      true,
    );

    // Clamping to 0 hid a real liability and overstated net worth, which is
    // the worse direction to be wrong in.
    const row = await prisma.account.findUnique({ where: { id: account.id } });
    expect(row?.balance.toNumber()).toBe(-50);
  });
});
