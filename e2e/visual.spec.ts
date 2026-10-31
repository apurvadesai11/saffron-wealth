import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { prisma } from "../lib/prisma";
import { archiveAccount, createAccount } from "../lib/accounts";

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

const SHOT = { fullPage: true, maxDiffPixels: 0, animations: "disabled" as const };

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  // Progress bars animate their width.
  await page.waitForTimeout(400);
}

test.describe("@visual screens", () => {
  test("monthly review — budget and cashflow", async ({ page }) => {
    await page.goto("/");
    await settle(page);
    await expect(page).toHaveScreenshot("review-current.png", SHOT);

    // The seeded transactions are in Feb 2026; walk back so every bar colour shows.
    const prev = page.getByRole("button", { name: "Previous month" });
    while (!(await page.getByText(/February 2026/).isVisible())) {
      await prev.click();
    }
    await settle(page);
    await expect(page).toHaveScreenshot("review-budget.png", SHOT);

    await page.getByRole("button", { name: "cashflow" }).click();
    await settle(page);
    await expect(page).toHaveScreenshot("review-cashflow.png", SHOT);

    await page.getByRole("button", { name: /budget alert/ }).click();
    await expect(page.getByRole("dialog", { name: "Budget alerts" })).toBeVisible();
    await expect(page).toHaveScreenshot("review-alerts.png", SHOT);
  });

  test("transactions — list, add form, import modal", async ({ page }) => {
    await page.goto("/transactions");
    await settle(page);
    await expect(page).toHaveScreenshot("transactions.png", SHOT);

    await page.getByRole("button", { name: "+ Add Transaction" }).click();
    await settle(page);
    await expect(page).toHaveScreenshot("transactions-add.png", SHOT);
    await page.reload();

    await page.getByRole("button", { name: "Import from Monarch" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page).toHaveScreenshot("transactions-import.png", SHOT);
  });

  test("net worth — page, archived group, edit modal", async ({ page }) => {
    await page.goto("/net-worth");
    await settle(page);
    await page.getByText(/^Archived \(/).click();
    await expect(page).toHaveScreenshot("net-worth.png", SHOT);

    await page.getByRole("button", { name: /^Visual Checking Cash/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page).toHaveScreenshot("net-worth-edit.png", SHOT);
  });

  test("profile", async ({ page }) => {
    await page.goto("/profile");
    await settle(page);
    // The worker user's email and name carry a timestamp and worker index.
    await expect(page).toHaveScreenshot("profile.png", {
      ...SHOT,
      mask: [page.locator("input"), page.getByText(/e2e-worker-/)],
    });
  });

  test("auth pages", async ({ browser }) => {
    const anon = await browser.newPage();
    for (const path of ["/login", "/register", "/password-reset"]) {
      await anon.goto(path);
      await settle(anon);
      await expect(anon).toHaveScreenshot(`auth${path.replace("/", "-")}.png`, SHOT);
    }
    await anon.close();
  });
});
