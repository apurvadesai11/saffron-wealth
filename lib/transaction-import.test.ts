// The larger of the two import pipelines (266 lines), covered until now only
// indirectly through app/api/transactions/__tests__/import.test.ts. Those are
// integration tests against real Postgres and they earn their keep, but they
// exercise one fixture file — so the transform's edge cases (a header Monarch
// renamed, a row missing a required cell, a repeat inside the file) had no
// coverage at all.
//
// The three functions that touch the database are mocked here and nothing
// else is, so the two-pass transform, the first-seen ordering, the date-range
// scan and the dedup arithmetic all run for real. `commit: false` is the
// read-only path, which is what the preview calls.
import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findExistingExternalHashes: vi.fn(),
  resolveCategoryIds: vi.fn(),
  resolveAccountIds: vi.fn(),
  createImportedTransactions: vi.fn(),
}));

vi.mock("./transactions", () => ({
  findExistingExternalHashes: mocks.findExistingExternalHashes,
  createImportedTransactions: mocks.createImportedTransactions,
}));
vi.mock("./categories", () => ({ resolveCategoryIds: mocks.resolveCategoryIds }));
vi.mock("./accounts", () => ({ resolveAccountIds: mocks.resolveAccountIds }));

import { runImportPipeline, REQUIRED_IMPORT_COLUMNS } from "./transaction-import";

const HEADER = ["Date", "Merchant", "Category", "Account", "Original Statement", "Notes", "Amount", "Id"];

function row(over: Partial<Record<string, string>> = {}): Record<string, string> {
  return {
    Date: "2026-02-14",
    Merchant: "Fresh Grocer",
    Category: "Groceries",
    Account: "Everyday Checking",
    "Original Statement": "FRESH GROCER #12",
    Notes: "",
    Amount: "-84.50",
    Id: "",
    ...over,
  };
}

// Stands in for the Prisma client; nothing in the read-only path dereferences
// it, because the three functions that would are mocked above.
const CLIENT = {} as never;

async function preview(rows: Record<string, string>[], header: string[] = HEADER) {
  return runImportPipeline(CLIENT, "u1", rows, header, { commit: false });
}

beforeEach(() => {
  mocks.findExistingExternalHashes.mockReset().mockResolvedValue(new Set<string>());
  // Echo back whatever it is asked to resolve, reporting all of it as new.
  // `newNames` is a Set, matching the real resolvers' return type — the
  // pipeline calls .has() on it, so an array here would be a fake that lies.
  mocks.resolveCategoryIds.mockReset().mockImplementation(
    async (_userId: string, entries: { name: string }[]) => ({
      idByName: new Map(entries.map((e) => [e.name, `cat-${e.name}`])),
      newNames: new Set(entries.map((e) => e.name)),
    }),
  );
  mocks.resolveAccountIds.mockReset().mockImplementation(
    async (_userId: string, names: string[]) => ({
      idByName: new Map(names.map((n) => [n, `acc-${n}`])),
      newNames: new Set(names),
    }),
  );
  mocks.createImportedTransactions.mockReset().mockResolvedValue({ imported: 0, skipped: 0 });
});

describe("column lookup", () => {
  it("reads columns case-insensitively and ignores surrounding whitespace", async () => {
    // Monarch has renamed columns twice; validateHeader matches leniently, so
    // the reader has to as well or a leniently-matched column reads as empty.
    //
    // papaparse keys each row object by the header's own spelling, so the
    // fixture below is keyed the same way — that is the shape the pipeline
    // actually receives, and keying it by the canonical names would test a
    // situation that cannot arise.
    const shouty = ["  DATE ", "MERCHANT", "category", "ACCOUNT", "Original Statement", "notes", " amount", "ID"];
    const shoutyRow = {
      "  DATE ": "2026-02-14",
      MERCHANT: "Fresh Grocer",
      category: "Groceries",
      ACCOUNT: "Everyday Checking",
      "Original Statement": "FRESH GROCER #12",
      notes: "",
      " amount": "-84.50",
      ID: "",
    };

    const result = await preview([shoutyRow], shouty);

    expect(result.summary.newTransactions).toBe(1);
    expect(result.summary.dateRange).toEqual({ from: "2026-02-14", to: "2026-02-14" });
    expect(result.summary.newCategories).toEqual([
      { name: "Groceries", inferredType: "expense" },
    ]);
  });

  it("tolerates a header with extra columns it does not know about", async () => {
    const withExtras = [...HEADER, "Tags", "Split"];
    const result = await preview([{ ...row(), Tags: "x", Split: "n" }], withExtras);

    expect(result.summary.newTransactions).toBe(1);
  });

  it("names the four columns the header validator requires", () => {
    expect(REQUIRED_IMPORT_COLUMNS).toEqual(["Date", "Amount", "Account", "Category"]);
  });
});

describe("row dropping", () => {
  it("counts a dropped row in totalRows but not as a transaction", async () => {
    const result = await preview([row(), row({ Date: "not-a-date" })]);

    expect(result.summary.totalRows).toBe(2);
    expect(result.summary.newTransactions).toBe(1);
    expect(result.summary.duplicateRows).toBe(0);
  });

  it("drops a row missing any required cell", async () => {
    const result = await preview([
      row({ Account: "" }),
      row({ Category: "" }),
      row({ Date: "" }),
      row({ Date: "2026/02/14" }),
    ]);

    expect(result.summary.totalRows).toBe(4);
    expect(result.summary.newTransactions).toBe(0);
  });

  it("drops a row whose amount cannot be parsed", async () => {
    const result = await preview([row({ Amount: "" }), row({ Amount: "n/a" })]);

    expect(result.summary.newTransactions).toBe(0);
  });

  it("keeps a display-formatted amount, including parenthesised negatives", async () => {
    const result = await preview([
      row({ Amount: "$1,234.56", Id: "a" }),
      row({ Amount: "(84.50)", Id: "b" }),
    ]);

    expect(result.summary.newTransactions).toBe(2);
  });
});

describe("dedup", () => {
  // Monarch's own row Id wins over a content hash, because the fallback hash
  // keys on merchant — a field users rename in Monarch's UI.
  it("treats two rows with the same Monarch Id as one", async () => {
    const result = await preview([
      row({ Id: "mid-1" }),
      row({ Id: "mid-1", Merchant: "Renamed In Monarch" }),
    ]);

    expect(result.summary.newTransactions).toBe(1);
    expect(result.summary.duplicateRows).toBe(1);
  });

  it("treats identical id-less rows as one, via the content hash", async () => {
    const result = await preview([row(), row()]);

    expect(result.summary.newTransactions).toBe(1);
    expect(result.summary.duplicateRows).toBe(1);
  });

  it("treats id-less rows differing only in merchant as distinct", async () => {
    const result = await preview([row(), row({ Merchant: "Other Shop" })]);

    expect(result.summary.newTransactions).toBe(2);
    expect(result.summary.duplicateRows).toBe(0);
  });

  // The optimization worth pinning: a within-file repeat is already known to
  // be a duplicate, so only first-seen hashes need a database round trip.
  it("asks the database only about hashes seen for the first time", async () => {
    await preview([row({ Id: "mid-1" }), row({ Id: "mid-1" }), row({ Id: "mid-2" })]);

    const [, hashes] = mocks.findExistingExternalHashes.mock.calls[0];
    expect(hashes).toEqual(["mid:mid-1", "mid:mid-2"]);
  });

  it("counts a row already in the database as a duplicate", async () => {
    mocks.findExistingExternalHashes.mockResolvedValue(new Set(["mid:mid-1"]));

    const result = await preview([row({ Id: "mid-1" }), row({ Id: "mid-2" })]);

    expect(result.summary.newTransactions).toBe(1);
    expect(result.summary.duplicateRows).toBe(1);
  });
});

describe("category type inference", () => {
  // Two passes exist because inferCategoryType needs every amount for a
  // category before any row in it can be typed — a one-pass version would
  // type the first row from a single sample.
  it("types a category from the whole batch's dominant sign, not the first row", async () => {
    const result = await preview([
      row({ Category: "Salary", Amount: "-10", Id: "a" }),
      row({ Category: "Salary", Amount: "2500", Id: "b" }),
      row({ Category: "Salary", Amount: "2500", Id: "c" }),
    ]);

    expect(result.summary.newCategories).toEqual([{ name: "Salary", inferredType: "income" }]);
  });

  it("defaults a tied batch to expense", async () => {
    const result = await preview([
      row({ Category: "Mystery", Amount: "-10", Id: "a" }),
      row({ Category: "Mystery", Amount: "10", Id: "b" }),
    ]);

    expect(result.summary.newCategories).toEqual([{ name: "Mystery", inferredType: "expense" }]);
  });

  it("types a transfer-like category by name, whatever the signs", async () => {
    const result = await preview([
      row({ Category: "Credit Card Payment", Amount: "200", Id: "a" }),
      row({ Category: "Credit Card Payment", Amount: "300", Id: "b" }),
    ]);

    expect(result.summary.newCategories).toEqual([
      { name: "Credit Card Payment", inferredType: "transfer" },
    ]);
  });
});

describe("summary ordering and ranges", () => {
  it("lists categories and accounts in first-seen order", async () => {
    const result = await preview([
      row({ Category: "Zeta", Account: "Zed Account", Id: "a" }),
      row({ Category: "Alpha", Account: "Aye Account", Id: "b" }),
    ]);

    expect(result.summary.newCategories.map((c) => c.name)).toEqual(["Zeta", "Alpha"]);
    expect(result.summary.newAccounts.map((a) => a.name)).toEqual(["Zed Account", "Aye Account"]);
  });

  it("reports the date range across every kept row, regardless of file order", async () => {
    const result = await preview([
      row({ Date: "2026-02-14", Id: "a" }),
      row({ Date: "2025-11-01", Id: "b" }),
      row({ Date: "2026-06-30", Id: "c" }),
    ]);

    expect(result.summary.dateRange).toEqual({ from: "2025-11-01", to: "2026-06-30" });
  });

  it("guesses each new account's type from its name", async () => {
    const result = await preview([
      row({ Account: "Everyday Checking", Id: "a" }),
      row({ Account: "Roth IRA (...1234)", Id: "b" }),
      row({ Account: "Some Unlabelled Thing", Id: "c" }),
    ]);

    expect(result.summary.newAccounts).toEqual([
      { name: "Everyday Checking", guessedType: "cash" },
      { name: "Roth IRA (...1234)", guessedType: "roth_ira" },
      // Item 15c: unrecognized is unrecognized, not an asset.
      { name: "Some Unlabelled Thing", guessedType: "uncategorized" },
    ]);
  });

  it("returns an empty, well-formed summary for an empty file", async () => {
    const result = await preview([]);

    expect(result.summary).toEqual({
      totalRows: 0,
      newTransactions: 0,
      duplicateRows: 0,
      newAccounts: [],
      newCategories: [],
      dateRange: { from: "", to: "" },
    });
  });
});

describe("preview writes nothing", () => {
  it("never calls the create path, and tells the resolvers not to write", async () => {
    await preview([row()]);

    expect(mocks.createImportedTransactions).not.toHaveBeenCalled();
    // Fourth argument is the write flag on both resolvers.
    expect(mocks.resolveCategoryIds.mock.calls[0][3]).toBe(false);
    expect(mocks.resolveAccountIds.mock.calls[0][3]).toBe(false);
  });

  it("omits the imported/skipped counters, which only a commit produces", async () => {
    const result = await preview([row()]);

    expect(result.imported).toBeUndefined();
    expect(result.skipped).toBeUndefined();
  });
});
