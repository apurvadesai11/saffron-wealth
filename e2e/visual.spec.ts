import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { prisma } from "../lib/prisma";
import { archiveAccount, createAccount } from "../lib/accounts";
import { saveFinancialProfile } from "../lib/financial-profile";

// Full-page screenshots of every screen, used as a local gate when a change is
// meant to be visually neutral (the theme-token conversion was the first).
// Baselines are not committed: font rendering differs between macOS and CI's
// Linux runners, so a committed baseline would fail on whichever OS didn't
// produce it. playwright.config.ts skips this file unless VISUAL is set.
//
// Workflow: on the base branch, `npm run test:visual -- --update-snapshots`;
// on the branch, `npm run test:visual`. Run both on the same day — the Monthly
// Review page opens on the current month. The script runs one worker because
// the worker-scoped user is shared with any other spec in the same worker, and
// their accounts would show up here.

test.describe.configure({ mode: "serial" });

// Synthetic, invented data only (see CLAUDE.md's privacy rule).
test.beforeAll(async ({ authedUser }) => {
  const userId = authedUser.id;
  const checking = await createAccount(userId, {
    name: "Visual Checking", type: "cash", institution: "Example Bank", balance: 4200,
  });
  await createAccount(userId, {
    name: "Visual Brokerage", type: "brokerage", institution: null, balance: 18500,
  });
  await createAccount(userId, {
    name: "Visual Card", type: "credit_card", institution: "Example Bank", balance: 650,
  });
  const old = await createAccount(userId, {
    name: "Visual Old Savings", type: "cash", institution: null, balance: 0,
  });
  await archiveAccount(userId, old.id);

  // A short history so the chart draws a line rather than its empty state.
  const months = ["2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01"];
  await prisma.accountBalanceEvent.createMany({
    data: months.map((asOf, i) => ({
      userId,
      accountId: checking.id,
      balance: 3000 + i * 300,
      asOf: new Date(`${asOf}T00:00:00.000Z`),
    })),
  });
});

// threshold: 0 matters as much as maxDiffPixels: 0. Playwright's default
// per-pixel tolerance (0.2) treats nearby colours as equal, and passed a
// field that was grey instead of the dark surface colour.
const SHOT = { fullPage: true, maxDiffPixels: 0, threshold: 0, animations: "disabled" as const };

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  // Progress bars animate their width.
  await page.waitForTimeout(400);
}

// Light shots keep their original names, so baselines from before dark mode
// existed still apply; dark shots get a suffix.
for (const scheme of ["light", "dark"] as const) {
  const name = (base: string) => (scheme === "light" ? `${base}.png` : `${base}-dark.png`);

  test.describe(`@visual screens (${scheme})`, () => {
    test.use({ colorScheme: scheme });

    test("monthly review — budget and cashflow", async ({ page }) => {
      await page.goto("/monthly-review");
      await settle(page);
      await expect(page).toHaveScreenshot(name("review-current"), SHOT);

      // The seeded transactions are in Feb 2026; walk back so every bar colour shows.
      const prev = page.getByRole("button", { name: "Previous month" });
      while (!(await page.getByText(/February 2026/).isVisible())) {
        await prev.click();
      }
      await page.getByRole("button", { name: /^budget$/i }).click();
      await settle(page);
      await expect(page).toHaveScreenshot(name("review-budget"), SHOT);

      await page.getByRole("button", { name: /^cashflow$/i }).click();
      await settle(page);
      await expect(page).toHaveScreenshot(name("review-cashflow"), SHOT);

      await page.getByRole("button", { name: /budget alert/ }).click();
      await expect(page.getByRole("dialog", { name: "Budget alerts" })).toBeVisible();
      await expect(page).toHaveScreenshot(name("review-alerts"), SHOT);
    });

    test("transactions — list, add form, import modal", async ({ page }) => {
      await page.goto("/transactions");
      await settle(page);
      await expect(page).toHaveScreenshot(name("transactions"), SHOT);

      await page.getByRole("button", { name: "+ Add Transaction" }).click();
      await settle(page);
      await expect(page).toHaveScreenshot(name("transactions-add"), SHOT);
      await page.reload();

      await page.getByRole("button", { name: "Import from Monarch" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page).toHaveScreenshot(name("transactions-import"), SHOT);
    });

    test("net worth — page, archived group, edit modal", async ({ page }) => {
      await page.goto("/net-worth");
      await settle(page);
      await page.getByText(/^Archived \(/).click();
      await expect(page).toHaveScreenshot(name("net-worth"), SHOT);

      await page.getByRole("button", { name: /^Visual Checking Cash/ }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page).toHaveScreenshot(name("net-worth-edit"), SHOT);
    });

    test("financial profile", async ({ page }) => {
      await page.goto("/financial-profile");
      await settle(page);
      await expect(page).toHaveScreenshot(name("financial-profile"), SHOT);
    });

    test("fire calculator — tax prompt, years to FI, coast FI", async ({ page, authedUser }) => {
      // Saved here and removed after, not in beforeAll: a saved profile would
      // turn the financial-profile screen above into the filled-in form. An
      // RSU-only income has no bank deposits to infer a tax rate from, so the
      // page opens on the prompt.
      await saveFinancialProfile(authedUser.id, {
        age: 35,
        targetRetirementAge: 55,
        expectedRealReturnPct: 5,
        safeWithdrawalRatePct: 4,
        inflationPct: 2.5,
        filingStatus: null,
        employerMatch: null,
        incomeStreams: [{ kind: "rsu", label: null, annualAmount: 60000, frequency: "quarterly" }],
        contributionTargets: [],
      });
      try {
        await page.goto("/fire");
        await settle(page);
        await expect(page).toHaveScreenshot(name("fire-tax-prompt"), SHOT);

        await page.getByLabel("Effective tax rate (%)").fill("25");
        await page.getByRole("button", { name: "Calculate" }).click();
        await expect(page.getByRole("region", { name: "FI number", exact: true })).toBeVisible();
        await settle(page);
        await expect(page).toHaveScreenshot(name("fire"), SHOT);

        await page.getByRole("tab", { name: "Coast FI" }).click();
        await settle(page);
        await expect(page).toHaveScreenshot(name("fire-coast"), SHOT);
      } finally {
        await prisma.financialProfile.deleteMany({ where: { userId: authedUser.id } });
      }
    });

    test("profile", async ({ page }) => {
      await page.goto("/profile");
      await settle(page);
      // The worker user's email and name carry a timestamp and worker index.
      await expect(page).toHaveScreenshot(name("profile"), {
        ...SHOT,
        mask: [page.locator("input"), page.getByText(/e2e-worker-/)],
      });
    });

    test("auth pages", async ({ browser }) => {
      const anon = await browser.newPage({ colorScheme: scheme });
      for (const path of ["/login", "/register", "/password-reset"]) {
        await anon.goto(path);
        await settle(anon);
        await expect(anon).toHaveScreenshot(name(`auth${path.replace("/", "-")}`), SHOT);
      }
      await anon.close();
    });
  });
}
