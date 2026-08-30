import { randomBytes } from "node:crypto";
import { test as base, type BrowserContext } from "@playwright/test";
import { prisma } from "../lib/prisma";
import { createSession, revokeAllSessionsForUser } from "../lib/auth/sessions";
import { CSRF_COOKIE_NAME } from "../lib/auth/csrf-shared";
import { MOCK_CATEGORIES, MOCK_TRANSACTIONS, MOCK_BUDGETS } from "../lib/mock-data";

// Financial data is real Postgres now (Phase 2a), not the in-memory
// AppProvider seed — a freshly created user has zero categories/transactions/
// budgets. smoke.spec.ts's assertions (a Netflix transaction, a Groceries
// budget with enough history for "Use this →", etc.) depend on the same
// dataset the old mock/in-memory system provided, so reuse MOCK_* verbatim as
// the seed content: single source of truth for what those specs expect,
// rather than a second hand-authored fixture dataset that could drift.
async function seedFinancialData(userId: string) {
  // Category.id is a global primary key (not scoped per user), and Playwright
  // runs workers in parallel — reusing MOCK_CATEGORIES' fixed ids ('housing',
  // 'groceries', ...) verbatim across workers would collide. Let Prisma
  // generate real ids and remap MOCK_TRANSACTIONS/MOCK_BUDGETS' categoryId
  // references (created sequentially, not createMany, so each id is known).
  const idMap = new Map<string, string>(); // mock categoryId -> this worker's real id
  for (const [i, c] of MOCK_CATEGORIES.entries()) {
    const created = await prisma.category.create({
      data: { userId, name: c.name, type: c.type, color: c.color, sortOrder: i },
      select: { id: true },
    });
    idMap.set(c.id, created.id);
  }

  await prisma.transaction.createMany({
    data: MOCK_TRANSACTIONS.map(t => ({
      userId,
      categoryId: idMap.get(t.categoryId)!,
      description: t.description,
      amount: t.amount,
      type: t.type,
      date: new Date(`${t.date}T00:00:00.000Z`),
    })),
  });
  await prisma.budget.createMany({
    data: MOCK_BUDGETS.map(b => ({
      userId,
      categoryId: idMap.get(b.categoryId)!,
      amount: b.amount,
      period: b.period,
    })),
  });
}

// A real authenticated user, created once per Playwright worker. The raw
// session token is returned (the Session row stores only its SHA-256 hash) so
// tests can put it directly in the sw_session cookie.
//
// Worker scope keeps DB churn low — fully parallel test files share the user
// for their worker. Each test still gets its own browser context, so cookies
// don't leak across tests.
export interface AuthedUser {
  id: string;
  email: string;
  rawToken: string;
}

type WorkerFixtures = {
  authedUser: AuthedUser;
};

type TestFixtures = {
  authedContext: BrowserContext;
};

export const test = base.extend<TestFixtures, WorkerFixtures>({
  authedUser: [
    async ({}, use, workerInfo) => {
      const email = `e2e-worker-${workerInfo.workerIndex}-${Date.now()}@example.test`;
      const user = await prisma.user.create({
        data: {
          email,
          emailNormalized: email.toLowerCase(),
          firstName: "E2E",
          lastName: `Worker${workerInfo.workerIndex}`,
        },
      });
      const { rawToken } = await createSession(user.id, "playwright", "127.0.0.1");
      await seedFinancialData(user.id);

      await use({ id: user.id, email, rawToken });

      // Cascade deletes sessions, oauth accounts, etc. via schema relations.
      // Wrap in catch so a failed DB at teardown doesn't mask the real test
      // failure.
      await revokeAllSessionsForUser(user.id).catch(() => {});
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    },
    { scope: "worker" },
  ],

  // Per-test browser context with the real session cookie pre-set. Most smoke
  // tests should use `page` from this fixture (it inherits this context).
  context: async ({ context, authedUser }, use) => {
    // Real logins get the sw_csrf double-submit cookie from proxy.ts on the
    // way through auth pages; this fixture skips that flow, so any test that
    // performs a real mutation (POST/PATCH/DELETE) needs the cookie seeded
    // here. Must be readable by client JS (httpOnly: false) — the client
    // reads it via readCsrfCookie() and echoes it back as the x-csrf-token
    // header for the double-submit check in validateCsrfFromRequest.
    const csrfToken = randomBytes(32).toString("base64url");
    await context.addCookies([
      {
        name: "sw_session",
        value: authedUser.rawToken,
        domain: "localhost",
        path: "/",
        sameSite: "Lax",
        httpOnly: true,
      },
      {
        name: CSRF_COOKIE_NAME,
        value: csrfToken,
        domain: "localhost",
        path: "/",
        sameSite: "Strict",
        httpOnly: false,
      },
    ]);
    await use(context);
  },
});

export { expect } from "@playwright/test";
