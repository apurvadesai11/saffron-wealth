// DB-backed tests for the transaction read layer's windowing and paging.
// The (app) layout used to hydrate EVERY transaction on every authenticated
// page, which is invisible at a dozen rows and seconds of latency plus a
// multi-megabyte payload at the several thousand a Monarch import creates.
// listTransactions now takes a date window, and queryTransactions serves the
// Transactions page its own filtered, cursor-paged slice.
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "./prisma";
import { listTransactions, queryTransactions } from "./transactions";
import { InvalidCursorError } from "./db-errors";

let userId: string | undefined;
let otherUserId: string | undefined;

afterEach(async () => {
  if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  if (otherUserId) await prisma.user.delete({ where: { id: otherUserId } }).catch(() => {});
  userId = undefined;
  otherUserId = undefined;
});

async function seedUser() {
  const email = `tx-query-test-${randomUUID()}@example.test`;
  const user = await prisma.user.create({
    data: { email, emailNormalized: email.toLowerCase(), firstName: "Query", lastName: "Test" },
  });
  userId = user.id;
  return user;
}

async function seedCategory(uid: string, name: string, type: string) {
  return prisma.category.create({
    data: { userId: uid, name, type, color: "bg-green-500" },
  });
}

// `date` is @db.Date, so it has to be written as a UTC midnight to land on
// the calendar day the test names.
function utcDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

async function seedTransaction(
  uid: string,
  categoryId: string,
  fields: { date: string; amount: number; description: string; type?: string },
) {
  return prisma.transaction.create({
    data: {
      userId: uid,
      categoryId,
      description: fields.description,
      amount: fields.amount,
      type: fields.type ?? "expense",
      date: utcDate(fields.date),
    },
  });
}

describe("listTransactions windowing", () => {
  it("returns every transaction when no window is given", async () => {
    const user = await seedUser();
    const cat = await seedCategory(user.id, "Groceries", "expense");
    await seedTransaction(user.id, cat.id, { date: "2019-03-04", amount: 10, description: "Old" });
    await seedTransaction(user.id, cat.id, { date: "2026-09-01", amount: 20, description: "New" });

    const rows = await listTransactions(user.id);

    expect(rows.map((r) => r.description)).toEqual(["New", "Old"]);
  });

  it("excludes transactions before `from`", async () => {
    const user = await seedUser();
    const cat = await seedCategory(user.id, "Groceries", "expense");
    await seedTransaction(user.id, cat.id, { date: "2019-03-04", amount: 10, description: "Old" });
    await seedTransaction(user.id, cat.id, { date: "2026-09-01", amount: 20, description: "New" });

    const rows = await listTransactions(user.id, { from: "2026-01-01" });

    expect(rows.map((r) => r.description)).toEqual(["New"]);
  });

  it("includes a transaction dated exactly on `from`", async () => {
    const user = await seedUser();
    const cat = await seedCategory(user.id, "Groceries", "expense");
    await seedTransaction(user.id, cat.id, { date: "2026-01-01", amount: 10, description: "Boundary" });

    const rows = await listTransactions(user.id, { from: "2026-01-01" });

    expect(rows.map((r) => r.description)).toEqual(["Boundary"]);
  });
});

describe("queryTransactions", () => {
  it("reports the full match count alongside a limited page", async () => {
    const user = await seedUser();
    const cat = await seedCategory(user.id, "Groceries", "expense");
    for (let i = 1; i <= 5; i++) {
      await seedTransaction(user.id, cat.id, {
        date: `2026-09-0${i}`,
        amount: i,
        description: `Tx ${i}`,
      });
    }

    const page = await queryTransactions(user.id, { limit: 2 });

    expect(page.transactions).toHaveLength(2);
    expect(page.total).toBe(5);
  });

  it("walks the whole result set across cursor pages without repeating a row", async () => {
    const user = await seedUser();
    const cat = await seedCategory(user.id, "Groceries", "expense");
    for (let i = 1; i <= 5; i++) {
      await seedTransaction(user.id, cat.id, {
        date: `2026-09-0${i}`,
        amount: i,
        description: `Tx ${i}`,
      });
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await queryTransactions(user.id, { limit: 2, cursor: cursor ?? undefined });
      seen.push(...page.transactions.map((t) => t.description));
      cursor = page.nextCursor;
    } while (cursor);

    expect(seen).toEqual(["Tx 5", "Tx 4", "Tx 3", "Tx 2", "Tx 1"]);
  });

  it("returns a null nextCursor on the last page", async () => {
    const user = await seedUser();
    const cat = await seedCategory(user.id, "Groceries", "expense");
    await seedTransaction(user.id, cat.id, { date: "2026-09-01", amount: 1, description: "Only" });

    const page = await queryTransactions(user.id, { limit: 10 });

    expect(page.nextCursor).toBeNull();
  });

  it("filters by date range inclusively on both ends", async () => {
    const user = await seedUser();
    const cat = await seedCategory(user.id, "Groceries", "expense");
    await seedTransaction(user.id, cat.id, { date: "2026-08-31", amount: 1, description: "Before" });
    await seedTransaction(user.id, cat.id, { date: "2026-09-01", amount: 2, description: "Start" });
    await seedTransaction(user.id, cat.id, { date: "2026-09-30", amount: 3, description: "End" });
    await seedTransaction(user.id, cat.id, { date: "2026-10-01", amount: 4, description: "After" });

    const page = await queryTransactions(user.id, { from: "2026-09-01", to: "2026-09-30" });

    expect(page.transactions.map((t) => t.description).sort()).toEqual(["End", "Start"]);
  });

  it("filters by category type", async () => {
    const user = await seedUser();
    const expense = await seedCategory(user.id, "Groceries", "expense");
    const income = await seedCategory(user.id, "Salary", "income");
    await seedTransaction(user.id, expense.id, { date: "2026-09-01", amount: 1, description: "Spend" });
    await seedTransaction(user.id, income.id, {
      date: "2026-09-02",
      amount: 2,
      description: "Earn",
      type: "income",
    });

    const page = await queryTransactions(user.id, { type: "income" });

    expect(page.transactions.map((t) => t.description)).toEqual(["Earn"]);
  });

  it("filters by category ids", async () => {
    const user = await seedUser();
    const groceries = await seedCategory(user.id, "Groceries", "expense");
    const rent = await seedCategory(user.id, "Rent", "expense");
    await seedTransaction(user.id, groceries.id, { date: "2026-09-01", amount: 1, description: "Food" });
    await seedTransaction(user.id, rent.id, { date: "2026-09-02", amount: 2, description: "Housing" });

    const page = await queryTransactions(user.id, { categoryIds: [rent.id] });

    expect(page.transactions.map((t) => t.description)).toEqual(["Housing"]);
  });

  it("filters by amount range inclusively", async () => {
    const user = await seedUser();
    const cat = await seedCategory(user.id, "Groceries", "expense");
    await seedTransaction(user.id, cat.id, { date: "2026-09-01", amount: 10, description: "Low" });
    await seedTransaction(user.id, cat.id, { date: "2026-09-02", amount: 50, description: "Mid" });
    await seedTransaction(user.id, cat.id, { date: "2026-09-03", amount: 90, description: "High" });

    const page = await queryTransactions(user.id, { amountMin: 50, amountMax: 90 });

    expect(page.transactions.map((t) => t.description).sort()).toEqual(["High", "Mid"]);
  });

  it("matches the search term against the description, case-insensitively", async () => {
    const user = await seedUser();
    const cat = await seedCategory(user.id, "Groceries", "expense");
    await seedTransaction(user.id, cat.id, { date: "2026-09-01", amount: 1, description: "Coffee Roasters" });
    await seedTransaction(user.id, cat.id, { date: "2026-09-02", amount: 2, description: "Hardware Store" });

    const page = await queryTransactions(user.id, { search: "coffee" });

    expect(page.transactions.map((t) => t.description)).toEqual(["Coffee Roasters"]);
  });

  it("matches the search term against the category name", async () => {
    const user = await seedUser();
    const cat = await seedCategory(user.id, "Groceries", "expense");
    await seedTransaction(user.id, cat.id, { date: "2026-09-01", amount: 1, description: "Unrelated" });

    const page = await queryTransactions(user.id, { search: "grocer" });

    expect(page.transactions.map((t) => t.description)).toEqual(["Unrelated"]);
  });

  it("matches the search term against the merchant", async () => {
    const user = await seedUser();
    const cat = await seedCategory(user.id, "Groceries", "expense");
    await prisma.transaction.create({
      data: {
        userId: user.id,
        categoryId: cat.id,
        description: "Card purchase",
        amount: 12,
        type: "expense",
        date: utcDate("2026-09-01"),
        merchant: "Corner Bakery",
      },
    });

    const page = await queryTransactions(user.id, { search: "bakery" });

    expect(page.transactions.map((t) => t.description)).toEqual(["Card purchase"]);
  });

  it("never returns another user's transactions", async () => {
    const user = await seedUser();
    const cat = await seedCategory(user.id, "Groceries", "expense");
    await seedTransaction(user.id, cat.id, { date: "2026-09-01", amount: 1, description: "Mine" });

    const otherEmail = `tx-query-other-${randomUUID()}@example.test`;
    const other = await prisma.user.create({
      data: {
        email: otherEmail,
        emailNormalized: otherEmail.toLowerCase(),
        firstName: "Other",
        lastName: "User",
      },
    });
    try {
      const otherCat = await seedCategory(other.id, "Groceries", "expense");
      await seedTransaction(other.id, otherCat.id, {
        date: "2026-09-02",
        amount: 2,
        description: "Theirs",
      });

      const page = await queryTransactions(user.id, {});

      expect(page.transactions.map((t) => t.description)).toEqual(["Mine"]);
      expect(page.total).toBe(1);
    } finally {
      await prisma.user.delete({ where: { id: other.id } }).catch(() => {});
    }
  });
});

// 20a — the client-supplied cursor went straight into Prisma's `cursor:`.
// buildWhere includes userId, so there was never a cross-tenant read; the
// defect is that a foreign or stale id made Prisma throw, which the route
// surfaced as a 500 instead of a clean 400.
describe("queryTransactions cursor validation", () => {
  async function seedOtherUser() {
    const email = `tx-query-other-${randomUUID()}@example.test`;
    const user = await prisma.user.create({
      data: { email, emailNormalized: email.toLowerCase(), firstName: "Other", lastName: "User" },
    });
    otherUserId = user.id;
    return user;
  }

  it("rejects a cursor that names no row at all", async () => {
    const user = await seedUser();

    await expect(
      queryTransactions(user.id, { cursor: randomUUID() }),
    ).rejects.toThrow(InvalidCursorError);
  });

  it("rejects a syntactically invalid cursor without reaching Prisma's cursor", async () => {
    const user = await seedUser();

    await expect(
      queryTransactions(user.id, { cursor: "not-an-id" }),
    ).rejects.toThrow(InvalidCursorError);
  });

  // The important one: another user's real transaction id. The where clause
  // already prevented reading their rows, but the request should be a clean
  // 400 rather than an error surfaced from the database driver.
  it("rejects another user's transaction id", async () => {
    const mine = await seedUser();
    const theirs = await seedOtherUser();
    const theirCat = await seedCategory(theirs.id, "Theirs", "expense");
    const theirTx = await seedTransaction(theirs.id, theirCat.id, {
      date: "2026-09-01",
      amount: 10,
      description: "Not mine",
    });

    await expect(
      queryTransactions(mine.id, { cursor: theirTx.id }),
    ).rejects.toThrow(InvalidCursorError);
  });

  it("accepts a cursor pointing at the caller's own row", async () => {
    const user = await seedUser();
    const cat = await seedCategory(user.id, "Groceries", "expense");
    for (let i = 1; i <= 3; i++) {
      await seedTransaction(user.id, cat.id, {
        date: `2026-09-0${i}`,
        amount: i,
        description: `Tx ${i}`,
      });
    }

    const first = await queryTransactions(user.id, { limit: 1 });
    const second = await queryTransactions(user.id, {
      limit: 1,
      cursor: first.nextCursor ?? undefined,
    });

    expect(second.transactions).toHaveLength(1);
    expect(second.transactions[0].description).toBe("Tx 2");
  });
});
