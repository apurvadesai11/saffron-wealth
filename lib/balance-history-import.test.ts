// The other large import pipeline (290 lines), covered until now only through
// app/api/accounts/__tests__/balance-history.test.ts against real Postgres.
// Those tests exercise the DB path well; what they don't reach is the
// transform's own arithmetic — the in-file (account, date) collapse, the
// last-wins rule for an account's final balance, the non-account denylist
// counter, and the dedup split that makes preview honest.
//
// The three DB-touching functions are mocked and nothing else is, so all of
// that runs for real.
import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upsertAccountsFromBalanceHistory: vi.fn(),
  findExistingBalanceEventDays: vi.fn(),
  createBalanceHistoryEvents: vi.fn(),
}));

vi.mock("./accounts", () => ({
  upsertAccountsFromBalanceHistory: mocks.upsertAccountsFromBalanceHistory,
  findExistingBalanceEventDays: mocks.findExistingBalanceEventDays,
  createBalanceHistoryEvents: mocks.createBalanceHistoryEvents,
}));

import {
  runBalanceHistoryImportPipeline,
  REQUIRED_BALANCE_HISTORY_COLUMNS,
} from "./balance-history-import";
import { NON_ACCOUNT_NAMES } from "./monarch-transform";

const HEADER = ["Date", "Account", "Balance"];
const CLIENT = {} as never;

function row(date: string, account: string, balance: string): Record<string, string> {
  return { Date: date, Account: account, Balance: balance };
}

/** Whatever groups the pipeline built, as the upsert saw them. */
function groupsSeen(): { name: string; lastDate: string; finalBalanceSigned: number }[] {
  return mocks.upsertAccountsFromBalanceHistory.mock.calls[0][1];
}

async function preview(rows: Record<string, string>[], header: string[] = HEADER) {
  return runBalanceHistoryImportPipeline(CLIENT, "u1", rows, header, { commit: false });
}

beforeEach(() => {
  // Every account reported as brand new, which is the first-import shape and
  // means no dedup lookup is expected for it.
  mocks.upsertAccountsFromBalanceHistory.mockReset().mockImplementation(
    async (_userId: string, groups: { name: string }[]) =>
      groups.map((g) => ({
        name: g.name,
        accountId: `acc-${g.name}`,
        isNew: true,
        finalType: "cash",
        archived: false,
      })),
  );
  mocks.findExistingBalanceEventDays.mockReset().mockResolvedValue(new Set<string>());
  mocks.createBalanceHistoryEvents.mockReset().mockResolvedValue(0);
});

describe("required columns", () => {
  it("names the three the header validator requires", () => {
    expect(REQUIRED_BALANCE_HISTORY_COLUMNS).toEqual(["Date", "Balance", "Account"]);
  });

  it("reads the header case-insensitively", async () => {
    const result = await preview(
      [{ " DATE": "2026-02-14", account: "Chk", BALANCE: "100" }],
      [" DATE", "account", "BALANCE"],
    );

    expect(result.summary.eventRows).toBe(1);
  });
});

describe("row dropping and the non-account denylist", () => {
  it("drops a row with an unparseable date or empty account", async () => {
    const result = await preview([
      row("2026-02-14", "Chk", "100"),
      row("nope", "Chk", "100"),
      row("2026-02-15", "", "100"),
    ]);

    expect(result.summary.eventRows).toBe(1);
  });

  it("drops a row whose balance will not parse", async () => {
    const result = await preview([row("2026-02-14", "Chk", "n/a")]);

    expect(result.summary.eventRows).toBe(0);
  });

  // These rows parse cleanly but are insurance progress counters, not
  // accounts — importing them would inflate assets. They get their own
  // counter rather than disappearing into the malformed-row silence, so the
  // preview can say what happened.
  it("counts denylisted names separately instead of silently dropping them", async () => {
    const result = await preview([
      row("2026-02-14", "Chk", "100"),
      row("2026-02-14", NON_ACCOUNT_NAMES[0], "500"),
      row("2026-02-14", NON_ACCOUNT_NAMES[1], "600"),
    ]);

    expect(result.summary.skippedNonAccountRows).toBe(2);
    expect(result.summary.eventRows).toBe(1);
    expect(result.summary.accountsFound).toBe(1);
  });

  it("matches the denylist case-insensitively", async () => {
    const result = await preview([row("2026-02-14", NON_ACCOUNT_NAMES[0].toUpperCase(), "500")]);

    expect(result.summary.skippedNonAccountRows).toBe(1);
  });
});

describe("in-file (account, date) collapse", () => {
  // Two rows for the same account and day would otherwise become two events
  // with an identical (accountId, asOf) and an identical recordedAt, leaving
  // the asOf-tie tiebreak nothing to prefer between them. Last in file wins,
  // matching the rule already used for an account's final balance.
  it("keeps only the last row for a repeated account-and-day", async () => {
    const result = await preview([
      row("2026-02-14", "Chk", "100"),
      row("2026-02-14", "Chk", "175"),
    ]);

    // Both rows are read...
    expect(result.summary.eventRows).toBe(2);
    // ...but they collapse to one event.
    expect(result.summary.newEventRows).toBe(1);
    expect(result.summary.duplicateEventRows).toBe(0);
  });

  it("does not collapse the same day across different accounts", async () => {
    const result = await preview([
      row("2026-02-14", "Chk", "100"),
      row("2026-02-14", "Sav", "200"),
    ]);

    expect(result.summary.newEventRows).toBe(2);
  });

  it("does not collapse different days for one account", async () => {
    const result = await preview([
      row("2026-02-13", "Chk", "100"),
      row("2026-02-14", "Chk", "175"),
    ]);

    expect(result.summary.newEventRows).toBe(2);
  });
});

describe("per-account grouping", () => {
  it("takes the last-in-file balance as the account's final balance", async () => {
    await preview([
      row("2026-01-01", "Chk", "100"),
      row("2026-02-14", "Chk", "250"),
    ]);

    const [chk] = groupsSeen();
    expect(chk.lastDate).toBe("2026-02-14");
    expect(chk.finalBalanceSigned).toBe(250);
  });

  // Two different last-wins rules live in this pipeline and it is worth being
  // precise about which is which:
  //
  //   - an account's lastDate/finalBalanceSigned is latest *by date*, so a
  //     file that is not in date order still reports the newest balance;
  //   - the (account, date) event collapse above is last *in file*, because
  //     within one day there is no date left to compare.
  //
  // Last-in-file breaks a tie for the former only when the dates are equal.
  it("takes the latest date, not the last row, when the file is out of order", async () => {
    await preview([
      row("2026-02-14", "Chk", "250"),
      row("2026-01-01", "Chk", "100"),
    ]);

    const [chk] = groupsSeen();
    expect(chk.lastDate).toBe("2026-02-14");
    expect(chk.finalBalanceSigned).toBe(250);
  });

  it("breaks a same-day tie by file order", async () => {
    await preview([
      row("2026-02-14", "Chk", "100"),
      row("2026-02-14", "Chk", "250"),
    ]);

    const [chk] = groupsSeen();
    expect(chk.finalBalanceSigned).toBe(250);
  });

  it("preserves a negative balance's sign, which is what the type guess reads", async () => {
    await preview([row("2026-02-14", "Sunset Card", "-1200")]);

    const [card] = groupsSeen();
    expect(card.finalBalanceSigned).toBe(-1200);
  });

  it("lists accounts in first-seen order", async () => {
    await preview([
      row("2026-02-14", "Zed", "1"),
      row("2026-02-14", "Aye", "2"),
    ]);

    expect(groupsSeen().map((g) => g.name)).toEqual(["Zed", "Aye"]);
  });

  it("reports the file's full date range regardless of row order", async () => {
    const result = await preview([
      row("2026-02-14", "Chk", "1"),
      row("2025-11-01", "Chk", "2"),
      row("2026-06-30", "Chk", "3"),
    ]);

    expect(result.summary.dateRange).toEqual({ from: "2025-11-01", to: "2026-06-30" });
  });
});

describe("dedup against existing history", () => {
  // A brand-new account cannot have prior events, so asking the database
  // about it would be a wasted round trip.
  it("does not look up days for brand-new accounts", async () => {
    await preview([row("2026-02-14", "Chk", "100")]);

    expect(mocks.findExistingBalanceEventDays).toHaveBeenCalledWith("u1", [], CLIENT);
  });

  it("looks up days for accounts that already existed", async () => {
    mocks.upsertAccountsFromBalanceHistory.mockResolvedValue([
      { name: "Chk", accountId: "acc-1", isNew: false, finalType: "cash", archived: false },
    ]);

    await preview([row("2026-02-14", "Chk", "100")]);

    expect(mocks.findExistingBalanceEventDays).toHaveBeenCalledWith("u1", ["acc-1"], CLIENT);
  });

  it("counts a day already in history as a duplicate, not a new row", async () => {
    mocks.upsertAccountsFromBalanceHistory.mockResolvedValue([
      { name: "Chk", accountId: "acc-1", isNew: false, finalType: "cash", archived: false },
    ]);
    mocks.findExistingBalanceEventDays.mockResolvedValue(new Set(["acc-1|2026-02-14"]));

    const result = await preview([
      row("2026-02-14", "Chk", "100"),
      row("2026-02-15", "Chk", "110"),
    ]);

    expect(result.summary.duplicateEventRows).toBe(1);
    expect(result.summary.newEventRows).toBe(1);
  });

  // The point of running the dedup read on the preview path too: re-exporting
  // full history in month two should preview close to zero new rows, not the
  // whole file.
  it("makes a full re-import preview as all duplicates", async () => {
    mocks.upsertAccountsFromBalanceHistory.mockResolvedValue([
      { name: "Chk", accountId: "acc-1", isNew: false, finalType: "cash", archived: false },
    ]);
    mocks.findExistingBalanceEventDays.mockResolvedValue(
      new Set(["acc-1|2026-02-14", "acc-1|2026-02-15"]),
    );

    const result = await preview([
      row("2026-02-14", "Chk", "100"),
      row("2026-02-15", "Chk", "110"),
    ]);

    expect(result.summary.newEventRows).toBe(0);
    expect(result.summary.duplicateEventRows).toBe(2);
  });
});

describe("preview writes nothing", () => {
  it("never inserts, and tells the upsert not to write", async () => {
    const result = await preview([row("2026-02-14", "Chk", "100")]);

    expect(mocks.createBalanceHistoryEvents).not.toHaveBeenCalled();
    // Fifth argument is the write flag.
    expect(mocks.upsertAccountsFromBalanceHistory.mock.calls[0][4]).toBe(false);
    expect(result.eventsInserted).toBeUndefined();
  });

  it("reports eventsInserted on a commit", async () => {
    mocks.createBalanceHistoryEvents.mockResolvedValue(2);

    const result = await runBalanceHistoryImportPipeline(
      CLIENT,
      "u1",
      [row("2026-02-14", "Chk", "100"), row("2026-02-15", "Chk", "110")],
      HEADER,
      { commit: true },
    );

    expect(mocks.upsertAccountsFromBalanceHistory.mock.calls[0][4]).toBe(true);
    expect(result.eventsInserted).toBe(2);
  });
});

describe("empty file", () => {
  it("returns a well-formed zeroed summary", async () => {
    const result = await preview([]);

    expect(result.summary).toEqual({
      accountsFound: 0,
      newAccounts: [],
      existingAccounts: 0,
      eventRows: 0,
      newEventRows: 0,
      duplicateEventRows: 0,
      skippedNonAccountRows: 0,
      typeConflicts: [],
      dateRange: { from: "", to: "" },
    });
  });
});
