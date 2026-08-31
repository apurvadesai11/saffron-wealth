import { test, expect } from "./fixtures";

// Accounts persist in Postgres and are scoped to the worker's authed user, so
// unlike the in-memory transaction/budget smoke tests, state here is NOT reset
// between tests in this file. Each test uses a unique account name (and
// cleans up what it creates) so assertions don't collide with other tests.

test.describe("Sidebar navigation", () => {
  test("navigates to Net Worth and marks it active", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /Net Worth/ }).click();
    await expect(page).toHaveURL("/net-worth");
    // exact: true — Task 8's NetWorthChart adds its own "Net Worth Over
    // Time" heading, which would otherwise substring-match too.
    await expect(page.getByRole("heading", { name: "Net Worth", exact: true })).toBeVisible();

    const netWorthLink = page.getByRole("link", { name: /Net Worth/ });
    await expect(netWorthLink).toHaveAttribute("aria-current", "page");
  });
});

test.describe("Net Worth page", () => {
  test("shows the summary cards", async ({ page }) => {
    await page.goto("/net-worth");
    await expect(page.getByText("Total Assets")).toBeVisible();
    await expect(page.getByText("Total Liabilities")).toBeVisible();
    // exact: true — Task 8's NetWorthChart adds its own "Net Worth Over
    // Time" heading, which would otherwise substring-match too.
    await expect(page.getByRole("heading", { name: "Net Worth", exact: true })).toBeVisible();
  });

  test("adds a new account and reflects it in the account list and summary", async ({ page }) => {
    const name = `E2E Brokerage ${Date.now()}`;
    await page.goto("/net-worth");

    await page.getByRole("button", { name: "+ Add Account" }).click();
    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible();

    await modal.getByLabel("Account name").fill(name);
    await modal.getByLabel("Type").selectOption("brokerage");
    await modal.getByLabel("Balance").fill("10000");
    await modal.getByRole("button", { name: "Add Account" }).click();

    await expect(modal).not.toBeVisible();
    await expect(page.getByText(name)).toBeVisible();
    await expect(page.getByText("$10000.00").first()).toBeVisible();
  });

  test("edits an account's balance and the summary updates", async ({ page }) => {
    const name = `E2E Edit Target ${Date.now()}`;
    await page.goto("/net-worth");

    // Seed via the UI so this test is self-contained.
    await page.getByRole("button", { name: "+ Add Account" }).click();
    let modal = page.getByRole("dialog");
    await modal.getByLabel("Account name").fill(name);
    await modal.getByLabel("Type").selectOption("cash");
    await modal.getByLabel("Balance").fill("1000");
    await modal.getByRole("button", { name: "Add Account" }).click();
    await expect(modal).not.toBeVisible();

    await page.getByText(name).click();
    modal = page.getByRole("dialog");
    await expect(modal.getByRole("heading", { name: "Edit Account" })).toBeVisible();

    const balanceInput = modal.getByLabel("Balance");
    await balanceInput.fill("2500");
    await modal.getByRole("button", { name: "Save Changes" }).click();
    await expect(modal).not.toBeVisible();

    await expect(page.getByText("$2500.00").first()).toBeVisible();
  });

  // "Delete" is a soft-archive (see lib/accounts.ts's archiveAccount) — as of
  // Task 8 the deleted account no longer vanishes outright, it moves into
  // the collapsed "Archived" group (with a Restore path back). This test
  // used to assert the name disappeared everywhere on the page; that
  // assertion is now specifically about the ACTIVE bucket groups, since the
  // name legitimately still exists under Archived. The Archived round trip
  // itself (excluded from totals, then restored) is covered in
  // e2e/net-worth-history.spec.ts.
  test("deletes an account: it disappears from its active bucket and appears under Archived", async ({ page }) => {
    const name = `E2E Delete Target ${Date.now()}`;
    await page.goto("/net-worth");

    await page.getByRole("button", { name: "+ Add Account" }).click();
    const modal = page.getByRole("dialog");
    await modal.getByLabel("Account name").fill(name);
    await modal.getByLabel("Type").selectOption("cash");
    await modal.getByLabel("Balance").fill("500");
    await modal.getByRole("button", { name: "Add Account" }).click();
    await expect(modal).not.toBeVisible();
    await expect(page.getByText(name)).toBeVisible();

    await page.getByRole("button", { name: `Delete ${name}` }).click();
    await expect(page.locator("[data-bucket]").getByText(name)).toHaveCount(0);

    const archivedGroup = page.locator('[data-state="archived-group"]');
    await archivedGroup.locator("summary").click();
    await expect(archivedGroup.getByText(name)).toBeVisible();
  });
});
