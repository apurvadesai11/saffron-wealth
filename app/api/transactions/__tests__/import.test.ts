import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
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

import { POST } from "../import/route";
import { seedUser, seedSession, cleanupUser } from "./helpers";

// Synthetic Monarch-shaped fixture (no real personal data — see CLAUDE.md's
// privacy rule). Exercises: a quoted-comma account name ("Travel Card,
// Signature"), one transfer row (Credit Card Payment), one income row
// (Salary), one expense row (Groceries, plus a second on Transport), and a
// byte-for-byte duplicate of the first row (same Id, so same externalHash).
// process.cwd() is the repo root for both `npm test` and CI — every other
// path in this project (e.g. .env loading) is already resolved that way.
const FIXTURE_PATH = join(
  process.cwd(),
  "app/api/transactions/__tests__/fixtures/monarch-transactions-sample.csv",
);
const FIXTURE_CSV = readFileSync(FIXTURE_PATH, "utf8");

const EXPECTED_FRESH_SUMMARY = {
  totalRows: 5,
  newTransactions: 4,
  duplicateRows: 1,
  newAccounts: [
    { name: "Everyday Checking", guessedType: "cash" },
    { name: "Sunset Credit Card", guessedType: "credit_card" },
    { name: "Travel Card, Signature", guessedType: "cash" },
  ],
  newCategories: [
    { name: "Groceries", inferredType: "expense" },
    { name: "Salary", inferredType: "income" },
    { name: "Credit Card Payment", inferredType: "transfer" },
    { name: "Transport", inferredType: "expense" },
  ],
  dateRange: { from: "2026-01-05", to: "2026-01-15" },
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
    // app/api/profile/__tests__/picture.test.ts's multipartRequest).
    const blob = opts.fileBytes
      ? new Blob([new Uint8Array(opts.fileBytes)], { type: "text/csv" })
      : new Blob([opts.fileText ?? FIXTURE_CSV], { type: "text/csv" });
    form.set("file", blob, opts.filename ?? "import.csv");
  }
  const headers = new Headers();
  if (opts.csrf) headers.set(CSRF_HEADER_NAME, opts.csrf);
  const req = new NextRequest("http://localhost/api/transactions/import", {
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

describe("POST /api/transactions/import", () => {
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
    // Overwrite the cookie with a different value than the header carries.
    req.cookies.set(CSRF_COOKIE_NAME, "cookie-token");
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("returns 400 naming the missing column when a required header is absent", async () => {
    const user = await signIn();
    userId = user.id;

    // No Amount column at all.
    const csv = "Date,Merchant,Category,Account\n2026-01-01,Foo,Bar,Baz\n";
    const req = multipartRequest({ mode: "preview", csrf: "csrf", fileText: csv });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.message).toContain("Amount");
    expect(body.error.message).toContain("Date, Merchant, Category, Account"); // echoes actual header
  });

  it("rejects a file over the 10MB cap", async () => {
    const user = await signIn();
    userId = user.id;

    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1024);
    const req = multipartRequest({
      mode: "preview",
      csrf: "csrf",
      fileBytes: oversized,
      filename: "big.csv",
    });
    const res = await POST(req);
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe("FILE_TOO_LARGE");

    // Nothing should have been read/parsed — no rows for this user.
    expect(await prisma.transaction.count({ where: { userId } })).toBe(0);
  });

  it("mode=preview parses and summarizes without writing anything", async () => {
    const user = await signIn();
    userId = user.id;

    const req = multipartRequest({ mode: "preview", csrf: "csrf" });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.summary).toEqual(EXPECTED_FRESH_SUMMARY);
    expect(body.imported).toBeUndefined();
    expect(body.skipped).toBeUndefined();

    expect(await prisma.transaction.count({ where: { userId } })).toBe(0);
    expect(await prisma.account.count({ where: { userId } })).toBe(0);
    expect(await prisma.category.count({ where: { userId } })).toBe(0);
  });

  it("mode=commit creates the expected transactions, accounts, and categories", async () => {
    const user = await signIn();
    userId = user.id;

    const req = multipartRequest({ mode: "commit", csrf: "csrf" });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.summary).toEqual(EXPECTED_FRESH_SUMMARY);
    expect(body.imported).toBe(4);
    expect(body.skipped).toBe(1);

    const accounts = await prisma.account.findMany({ where: { userId } });
    expect(accounts).toHaveLength(3);
    expect(accounts.map((a) => [a.name, a.type]).sort()).toEqual(
      [
        ["Everyday Checking", "cash"],
        ["Sunset Credit Card", "credit_card"],
        ["Travel Card, Signature", "cash"],
      ].sort(),
    );
    // Import has no balance to offer — every new account opens at 0.
    for (const a of accounts) expect(a.balance.toNumber()).toBe(0);

    const categories = await prisma.category.findMany({ where: { userId } });
    expect(categories).toHaveLength(4);
    expect(categories.map((c) => [c.name, c.type]).sort()).toEqual(
      [
        ["Groceries", "expense"],
        ["Salary", "income"],
        ["Credit Card Payment", "transfer"],
        ["Transport", "expense"],
      ].sort(),
    );

    const transactions = await prisma.transaction.findMany({ where: { userId } });
    expect(transactions).toHaveLength(4); // 5 rows, 1 duplicate skipped

    const groceries = transactions.find((t) => t.externalHash === "mid:imp-tx-0001");
    expect(groceries).toBeDefined();
    expect(groceries?.type).toBe("expense");
    expect(groceries?.amount.toNumber()).toBe(84.5);
    expect(groceries?.merchant).toBe("Fresh Grocer");

    const salary = transactions.find((t) => t.externalHash === "mid:imp-tx-0002");
    expect(salary?.type).toBe("income");
    expect(salary?.amount.toNumber()).toBe(2500);

    const transfer = transactions.find((t) => t.externalHash === "mid:imp-tx-0003");
    expect(transfer?.type).toBe("transfer");
    expect(transfer?.amount.toNumber()).toBe(200);

    // Confirms the quoted-comma account name parsed as ONE account, not two.
    const transport = transactions.find((t) => t.externalHash === "mid:imp-tx-0004");
    expect(transport?.type).toBe("expense");
    const travelCard = accounts.find((a) => a.name === "Travel Card, Signature");
    expect(transport?.accountId).toBe(travelCard?.id);
  });

  it("re-committing the same file imports 0 and skips all, without duplicating rows", async () => {
    const user = await signIn();
    userId = user.id;

    const first = await POST(multipartRequest({ mode: "commit", csrf: "csrf" }));
    expect((await first.json()).imported).toBe(4);

    const second = await POST(multipartRequest({ mode: "commit", csrf: "csrf" }));
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.imported).toBe(0);
    expect(secondBody.skipped).toBe(5); // all 5 rows in the file collide with existing hashes

    // Row count must be unchanged — no accounts/categories duplicated either.
    expect(await prisma.transaction.count({ where: { userId } })).toBe(4);
    expect(await prisma.account.count({ where: { userId } })).toBe(3);
    expect(await prisma.category.count({ where: { userId } })).toBe(4);
  });

  it("cross-user isolation: user A's import creates nothing visible to user B", async () => {
    const userA = await signIn();
    userId = userA.id;
    const resA = await POST(multipartRequest({ mode: "commit", csrf: "csrf" }));
    expect((await resA.json()).imported).toBe(4);

    const userB = await seedUser();
    otherUserId = userB.id;
    const { rawToken: bToken } = await seedSession(userB.id);
    mocks.sessionToken = bToken;

    // B's preview of the identical file must look exactly like a fresh
    // import — if A's categories/accounts/hashes leaked across users, B
    // would see fewer "new" entries or fewer duplicates than a clean run.
    const previewB = await POST(multipartRequest({ mode: "preview", csrf: "csrf" }));
    expect((await previewB.json()).summary).toEqual(EXPECTED_FRESH_SUMMARY);

    expect(await prisma.transaction.count({ where: { userId: userB.id } })).toBe(0);
    expect(await prisma.account.count({ where: { userId: userB.id } })).toBe(0);
    expect(await prisma.category.count({ where: { userId: userB.id } })).toBe(0);

    const commitB = await POST(multipartRequest({ mode: "commit", csrf: "csrf" }));
    expect((await commitB.json()).imported).toBe(4);

    // Each user's data stays scoped to them.
    expect(await prisma.transaction.count({ where: { userId: userA.id } })).toBe(4);
    expect(await prisma.transaction.count({ where: { userId: userB.id } })).toBe(4);
  });
});
