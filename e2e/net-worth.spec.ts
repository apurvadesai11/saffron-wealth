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
    await expect(page.getByRole("heading", { name: "Net Worth" })).toBeVisible();

    const netWorthLink = page.getByRole("link", { name: /Net Worth/ });
    await expect(netWorthLink).toHaveAttribute("aria-current", "page");
  });
});

test.describe("Net Worth page", () => {
  test("shows the summary cards", async ({ page }) => {
    await page.goto("/net-worth");
    await expect(page.getByText("Total Assets")).toBeVisible();
    await expect(page.getByText("Total Liabilities")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Net Worth" })).toBeVisible();
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

  test("deletes an account and it disappears from the list", async ({ page }) => {
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
    await expect(page.getByText(name)).toHaveCount(0);
  });
});
