import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createAccount, updateAccount } from "@/lib/accounts";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "@/lib/auth/csrf-shared";

const mocks = vi.hoisted(() => ({ sessionToken: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      (name === "sw_session" || name === "__Host-sw_session") && mocks.sessionToken
        ? { value: mocks.sessionToken }
        : undefined,
  }),
}));

import { POST } from "../balance-history/route";
import { seedUser, seedSession, cleanupUser } from "./helpers";

// Synthetic Monarch-shaped balance-history fixture (no real personal data —
// see CLAUDE.md's privacy rule). Three accounts exercise the three
// structural cases the Task 5 brief calls out: "Everyday Checking" is an
// asset running to the file's max date (and dips negative on its first day,
// to prove event history isn't clamped the way the account's current
// balance is); "Sample Credit Card" is a debt with negative CSV balances;
// "Legacy Brokerage" stops one day before the file max at a non-zero
// positive balance, so it must import archived. One row names a Monarch
// insurance-tracker "account" that isn't a real account at all.
const FIXTURE_PATH = join(
  process.cwd(),
  "app/api/accounts/__tests__/fixtures/balance-history-sample.csv",
);
const FIXTURE_CSV = readFileSync(FIXTURE_PATH, "utf8");

const EXPECTED_FRESH_SUMMARY = {
  accountsFound: 3,
  newAccounts: [
    { name: "Everyday Checking", guessedType: "cash", archived: false },
    { name: "Sample Credit Card", guessedType: "credit_card", archived: false },
    { name: "Legacy Brokerage", guessedType: "brokerage", archived: true },
  ],
  existingAccounts: 0,
  eventRows: 8,
  skippedNonAccountRows: 1,
  dateRange: { from: "2026-01-01", to: "2026-01-03" },
};

function multipartRequest(opts: {
  csrf?: string;
  mode?: string;
  withoutFile?: boolean;
  fileText?: string;
  fileBytes?: Buffer;
  filename?: string;
}): NextRequest {
  const form = new FormData();
  if (opts.mode !== undefined) form.set("mode", opts.mode);
  if (!opts.withoutFile) {
    // Wrap as Uint8Array — Buffer is ArrayBufferLike-typed, which strict TS
    // refuses to accept as a BlobPart in Node 20+ lib defs (same fix as
    // app/api/transactions/__tests__/import.test.ts's multipartRequest).
    const blob = opts.fileBytes
      ? new Blob([new Uint8Array(opts.fileBytes)], { type: "text/csv" })
      : new Blob([opts.fileText ?? FIXTURE_CSV], { type: "text/csv" });
    form.set("file", blob, opts.filename ?? "balance-history.csv");
  }
  const headers = new Headers();
  if (opts.csrf) headers.set(CSRF_HEADER_NAME, opts.csrf);
  const req = new NextRequest("http://localhost/api/accounts/balance-history", {
    method: "POST",
    headers,
    body: form,
  });
  if (opts.csrf) req.cookies.set(CSRF_COOKIE_NAME, opts.csrf);
  return req;
}

async function signIn() {
  const user = await seedUser();
  const { rawToken } = await seedSession(user.id);
  mocks.sessionToken = rawToken;
  return user;
}

let userId: string;
let otherUserId: string | undefined;

beforeEach(() => {
  mocks.sessionToken = null;
});

afterEach(async () => {
  if (userId) await cleanupUser(userId);
  if (otherUserId) await cleanupUser(otherUserId);
  userId = "";
  otherUserId = undefined;
});

describe("POST /api/accounts/balance-history", () => {
  it("returns 401 when not signed in", async () => {
    const req = multipartRequest({ csrf: "csrf", mode: "preview" });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("rejects requests with no CSRF token", async () => {
    const user = await signIn();
    userId = user.id;

    const req = multipartRequest({ mode: "preview" });
    const res = await POST(req);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("CSRF_FAILED");
  });

  it("rejects requests with a CSRF header that doesn't match the cookie", async () => {
    const user = await signIn();
    userId = user.id;

    const req = multipartRequest({ mode: "preview", csrf: "header-token" });
    req.cookies.set(CSRF_COOKIE_NAME, "cookie-token");
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("returns 400 naming the missing column when a required header is absent", async () => {
    const user = await signIn();
    userId = user.id;

    // No Balance column at all.
    const csv = "Date,Account\n2026-01-01,Foo\n";
    const req = multipartRequest({ mode: "preview", csrf: "csrf", fileText: csv });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.message).toContain("Balance");
  });

  it("rejects a file over the 20MB cap", async () => {
    const user = await signIn();
    userId = user.id;

    const oversized = Buffer.alloc(20 * 1024 * 1024 + 1024);
    const req = multipartRequest({
      mode: "preview",
      csrf: "csrf",
      fileBytes: oversized,
      filename: "big.csv",
    });
    const res = await POST(req);
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe("FILE_TOO_LARGE");

    expect(await prisma.account.count({ where: { userId } })).toBe(0);
  });

  it("mode=preview summarizes the three structural cases without writing anything", async () => {
    const user = await signIn();
    userId = user.id;

    const req = multipartRequest({ mode: "preview", csrf: "csrf" });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.summary).toEqual(EXPECTED_FRESH_SUMMARY);
    expect(body.eventsInserted).toBeUndefined();

    expect(await prisma.account.count({ where: { userId } })).toBe(0);
    expect(await prisma.accountBalanceEvent.count({ where: { userId } })).toBe(0);
  });

  it("mode=commit creates accounts with the right balances, types, and archived state", async () => {
    const user = await signIn();
    userId = user.id;

    const req = multipartRequest({ mode: "commit", csrf: "csrf" });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.summary).toEqual(EXPECTED_FRESH_SUMMARY);
    expect(body.eventsInserted).toBe(8);

    const accounts = await prisma.account.findMany({ where: { userId } });
    expect(accounts).toHaveLength(3);

    const checking = accounts.find((a) => a.name === "Everyday Checking")!;
    expect(checking.type).toBe("cash");
    expect(checking.balance.toNumber()).toBe(1200);
    expect(checking.balanceAsOf.toISOString().slice(0, 10)).toBe("2026-01-03");
    expect(checking.archivedAt).toBeNull();

    const creditCard = accounts.find((a) => a.name === "Sample Credit Card")!;
    expect(creditCard.type).toBe("credit_card");
    // Debt balances are stored positive even though the CSV carried negatives.
    expect(creditCard.balance.toNumber()).toBe(450);
    expect(creditCard.archivedAt).toBeNull();

    const brokerage = accounts.find((a) => a.name === "Legacy Brokerage")!;
    expect(brokerage.type).toBe("brokerage");
    expect(brokerage.balance.toNumber()).toBe(5200);
    // Closed early (last row 01-02, file max 01-03): imports archived.
    expect(brokerage.archivedAt).not.toBeNull();

    const events = await prisma.accountBalanceEvent.findMany({ where: { userId } });
    expect(events).toHaveLength(8);

    // asOf must be the CSV Date, never the insert time.
    const creditCardEvents = events
      .filter((e) => e.accountId === creditCard.id)
      .sort((a, b) => a.asOf.getTime() - b.asOf.getTime());
    expect(creditCardEvents.map((e) => e.asOf.toISOString().slice(0, 10))).toEqual([
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
    ]);
    // Debt event balances are stored positive too.
    expect(creditCardEvents.map((e) => e.balance.toNumber())).toEqual([200, 450, 450]);

    // The asset account's early overdraft day keeps its negative sign in
    // history — only the account's CURRENT balance clamps to 0 if negative,
    // never a historical event.
    const checkingEvents = events
      .filter((e) => e.accountId === checking.id)
      .sort((a, b) => a.asOf.getTime() - b.asOf.getTime());
    expect(checkingEvents.map((e) => e.balance.toNumber())).toEqual([-50, 1000, 1200]);
  });

  it("re-committing the same file inserts zero new events (application-level dedup)", async () => {
    const user = await signIn();
    userId = user.id;

    const first = await POST(multipartRequest({ mode: "commit", csrf: "csrf" }));
    expect((await first.json()).eventsInserted).toBe(8);

    const second = await POST(multipartRequest({ mode: "commit", csrf: "csrf" }));
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.eventsInserted).toBe(0);
    expect(secondBody.summary.existingAccounts).toBe(3);
    expect(secondBody.summary.newAccounts).toEqual([]);

    // Row count must be unchanged — dedup, not double-insert.
    expect(await prisma.accountBalanceEvent.count({ where: { userId } })).toBe(8);
    expect(await prisma.account.count({ where: { userId } })).toBe(3);
  });

  it("an existing account's user-corrected type survives re-import when the sign agrees", async () => {
    const user = await signIn();
    userId = user.id;

    // Pre-seed "Everyday Checking" with a type guessAccountType would never
    // produce for this name (an investments-bucket type instead of "cash"),
    // simulating a user who corrected it by hand.
    await createAccount(userId, {
      name: "Everyday Checking",
      type: "brokerage",
      institution: null,
      balance: 0,
    });

    const res = await POST(multipartRequest({ mode: "commit", csrf: "csrf" }));
    expect(res.status).toBe(200);

    const checking = await prisma.account.findFirst({ where: { userId, name: "Everyday Checking" } });
    // Final balance (1200) is positive and "brokerage" is an asset bucket —
    // sign agrees, so the user's correction must survive.
    expect(checking?.type).toBe("brokerage");
    expect(checking?.balance.toNumber()).toBe(1200);
  });

  it("an existing asset-typed account whose imported final balance is negative is re-typed (Ruling 7)", async () => {
    const user = await signIn();
    userId = user.id;

    await createAccount(userId, {
      name: "Old Brokerage",
      type: "brokerage", // asset bucket
      institution: null,
      balance: 0,
    });

    // Single-row CSV: this account now reports a negative final balance,
    // disagreeing with its stored asset-bucket type.
    const csv = "Date,Balance,Account\n2026-02-01,-800.00,Old Brokerage\n";
    const res = await POST(multipartRequest({ mode: "commit", csrf: "csrf", fileText: csv }));
    expect(res.status).toBe(200);

    const account = await prisma.account.findFirst({ where: { userId, name: "Old Brokerage" } });
    // Sign disagreement overrides the stored type — re-guessed from the
    // negative balance and the (non-mortgage-shaped) name as credit_card.
    expect(account?.type).toBe("credit_card");
    expect(account?.balance.toNumber()).toBe(800);
  });

  it("Ruling 8 regression: a same-day double balance edit via updateAccount still succeeds", async () => {
    const user = await signIn();
    userId = user.id;

    const account = await createAccount(userId, {
      name: "Regression Test",
      type: "cash",
      institution: null,
      balance: 100,
    });
    // Two edits in the same test (same calendar day) must both succeed — the
    // asOf column added for Task 5 must NOT carry a unique constraint that
    // would turn this normal Phase 1 flow into a 500.
    await expect(updateAccount(userId, account.id, { balance: 200 })).resolves.not.toBeNull();
    await expect(updateAccount(userId, account.id, { balance: 300 })).resolves.not.toBeNull();

    const events = await prisma.accountBalanceEvent.findMany({ where: { accountId: account.id } });
    // Opening balance + two balance-change events.
    expect(events).toHaveLength(3);
  });

  it("chunks inserts for more than 5,000 rows", async () => {
    const user = await signIn();
    userId = user.id;

    const rowsPerAccount = 2505; // 2 accounts x 2505 = 5,010 total, crossing the 5,000 chunk boundary
    const lines = ["Date,Balance,Account"];
    for (const account of ["Bulk Checking", "Bulk Savings"]) {
      for (let day = 0; day < rowsPerAccount; day++) {
        const date = addDays("2020-01-01", day);
        lines.push(`${date},${(1000 + day).toFixed(2)},${account}`);
      }
    }
    const csv = lines.join("\n") + "\n";

    const res = await POST(multipartRequest({ mode: "commit", csrf: "csrf", fileText: csv }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.eventRows).toBe(rowsPerAccount * 2);
    expect(body.eventsInserted).toBe(rowsPerAccount * 2);

    expect(await prisma.accountBalanceEvent.count({ where: { userId } })).toBe(rowsPerAccount * 2);
    const accounts = await prisma.account.findMany({ where: { userId } });
    expect(accounts).toHaveLength(2);
    // Both accounts run to the same file max date, so neither is archived.
    for (const a of accounts) expect(a.archivedAt).toBeNull();
  }, 20_000);

  it("cross-user isolation: user A's import creates nothing visible to user B", async () => {
    const userA = await signIn();
    userId = userA.id;
    const resA = await POST(multipartRequest({ mode: "commit", csrf: "csrf" }));
    expect((await resA.json()).eventsInserted).toBe(8);

    const userB = await seedUser();
    otherUserId = userB.id;
    const { rawToken: bToken } = await seedSession(userB.id);
    mocks.sessionToken = bToken;

    // B's preview of the identical file must look exactly like a fresh
    // import — if A's accounts/events leaked across users, B would see
    // fewer "new" accounts or a nonzero existingAccounts count.
    const previewB = await POST(multipartRequest({ mode: "preview", csrf: "csrf" }));
    expect((await previewB.json()).summary).toEqual(EXPECTED_FRESH_SUMMARY);

    expect(await prisma.account.count({ where: { userId: userB.id } })).toBe(0);
    expect(await prisma.accountBalanceEvent.count({ where: { userId: userB.id } })).toBe(0);

    const commitB = await POST(multipartRequest({ mode: "commit", csrf: "csrf" }));
    expect((await commitB.json()).eventsInserted).toBe(8);

    // Each user's data stays scoped to them.
    expect(await prisma.account.count({ where: { userId: userA.id } })).toBe(3);
    expect(await prisma.account.count({ where: { userId: userB.id } })).toBe(3);
  });
});

function addDays(base: string, days: number): string {
  const [y, m, d] = base.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}
