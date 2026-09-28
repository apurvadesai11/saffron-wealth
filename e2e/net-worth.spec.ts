import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";

// The archive control is a two-step confirm now (item 14a): the row's control
// opens the confirm, and "Yes, archive" commits it. Wording says archive
// because archiveAccount never removes the row.
async function archiveAccount(page: Page, name: string) {
  await page.getByRole("button", { name: `Archive ${name}` }).click();
  await page.getByRole("button", { name: /^Yes, archive/ }).click();
}


// Accounts persist in Postgres and are scoped to the worker's authed user, so
// unlike the in-memory transaction/budget smoke tests, state here is NOT reset
// between tests in this file. Each test uses a unique account name (and
// cleans up what it creates) so assertions don't collide with other tests.

test.describe("Sidebar navigation", () => {
  test("navigates to Net Worth and marks it active", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /Net Worth/ }).click();
    await expect(page).toHaveURL("/net-worth");
    // exact: true — the Net Worth page's NetWorthChart adds its own "Net Worth Over
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
    // exact: true — the Net Worth page's NetWorthChart adds its own "Net Worth Over
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
  // the Net Worth page the deleted account no longer vanishes outright, it moves into
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

    await archiveAccount(page, name);
    await expect(page.locator("[data-bucket]").getByText(name)).toHaveCount(0);

    const archivedGroup = page.locator('[data-state="archived-group"]');
    await archivedGroup.locator("summary").click();
    await expect(archivedGroup.getByText(name)).toBeVisible();
  });
});

// Item 9. The summary cards are driven by local state and update
// optimistically; the chart's series is a prop computed server-side. Nothing
// refreshed it, so after any account mutation the chart's most recent point
// contradicted the card directly above it until a manual reload — two
// different net-worth numbers on one screen.
//
// These assert the two agree, which is what the user actually sees, rather
// than asserting router.refresh was called (that is pinned in the unit test).
test.describe("Chart and summary cards agree after a mutation", () => {
  const chart = (page: import("@playwright/test").Page) =>
    page.locator("[data-latest-value]");

  async function latestChartValue(page: import("@playwright/test").Page): Promise<string | null> {
    return chart(page).getAttribute("data-latest-value");
  }

  async function addAccount(
    page: import("@playwright/test").Page,
    name: string,
    balance: string,
    type = "cash",
  ) {
    await page.getByRole("button", { name: "+ Add Account" }).click();
    const modal = page.getByRole("dialog");
    await modal.getByLabel("Account name").fill(name);
    await modal.getByLabel("Type").selectOption(type);
    await modal.getByLabel("Balance").fill(balance);
    await modal.getByRole("button", { name: "Add Account" }).click();
    await expect(modal).not.toBeVisible();
  }

  test("editing a balance moves the chart's last point with the summary card", async ({ page }) => {
    const name = `E2E Agree Edit ${Date.now()}`;
    await page.goto("/net-worth");

    await addAccount(page, name, "1000");
    const afterAdd = await latestChartValue(page);

    await page.getByText(name).click();
    const modal = page.getByRole("dialog");
    await modal.getByLabel("Balance").fill("7777");
    await modal.getByRole("button", { name: "Save Changes" }).click();
    await expect(modal).not.toBeVisible();

    // The chart has to move off its previous value without a reload.
    await expect(chart(page)).not.toHaveAttribute("data-latest-value", afterAdd ?? "");

    // And it must match the Net Worth card exactly.
    const cardText = await page
      .locator("[data-net-worth-sign]")
      .getByText(/^\$/)
      .first()
      .innerText();
    const cardValue = cardText.replace(/[$,]/g, "");
    await expect(chart(page)).toHaveAttribute("data-latest-value", cardValue);
  });

  test("archiving an account drops it from both the totals and the chart", async ({ page }) => {
    const name = `E2E Agree Archive ${Date.now()}`;
    await page.goto("/net-worth");

    await addAccount(page, name, "4321");
    const withAccount = await latestChartValue(page);

    await archiveAccount(page, name);
    await expect(page.locator("[data-bucket]").getByText(name)).toHaveCount(0);

    await expect(chart(page)).not.toHaveAttribute("data-latest-value", withAccount ?? "");

    const cardText = await page
      .locator("[data-net-worth-sign]")
      .getByText(/^\$/)
      .first()
      .innerText();
    await expect(chart(page)).toHaveAttribute(
      "data-latest-value",
      cardText.replace(/[$,]/g, ""),
    );
  });

  test("restoring an account returns it to both the totals and the chart", async ({ page }) => {
    const name = `E2E Agree Restore ${Date.now()}`;
    await page.goto("/net-worth");

    await addAccount(page, name, "2468");
    const withAccount = await latestChartValue(page);

    await archiveAccount(page, name);
    // Wait for the CHART to reflect the archive, not just the account list.
    // The list updates optimistically from local state before the refresh
    // lands, so reading the chart at that moment captures the pre-archive
    // value and makes the comparison below vacuous.
    await expect(chart(page)).not.toHaveAttribute("data-latest-value", withAccount ?? "");

    const archivedGroup = page.locator('[data-state="archived-group"]');
    await archivedGroup.locator("summary").click();
    await archivedGroup
      .locator("li", { hasText: name })
      .getByRole("button", { name: "Restore" })
      .click();

    await expect(page.locator("[data-bucket]").getByText(name)).toBeVisible();
    // Back to exactly where it was before the archive.
    await expect(chart(page)).toHaveAttribute("data-latest-value", withAccount ?? "");

    const cardText = await page
      .locator("[data-net-worth-sign]")
      .getByText(/^\$/)
      .first()
      .innerText();
    await expect(chart(page)).toHaveAttribute(
      "data-latest-value",
      cardText.replace(/[$,]/g, ""),
    );
  });
});
