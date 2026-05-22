import { test as base, type BrowserContext } from "@playwright/test";
import { prisma } from "../lib/prisma";
import { createSession, revokeAllSessionsForUser } from "../lib/auth/sessions";

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
    await context.addCookies([
      {
        name: "sw_session",
        value: authedUser.rawToken,
        domain: "localhost",
        path: "/",
        sameSite: "Lax",
        httpOnly: true,
      },
    ]);
    await use(context);
  },
});

export { expect } from "@playwright/test";
