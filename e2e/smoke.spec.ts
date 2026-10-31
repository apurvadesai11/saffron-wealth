import { test, expect } from "./fixtures";

// Budget/transaction state is in-memory and resets on every page load — each
// test starts fresh. Auth state is provided by the `context` fixture in
// ./fixtures.ts, which creates a real User+Session row per worker and
// attaches the resulting sw_session cookie to the browser context.

test.describe("App shell", () => {
  test("lands on Net Worth at /", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL("/net-worth");
    await expect(page.getByRole("heading", { name: "Net Worth", exact: true })).toBeVisible();
  });

  test("loads the Monthly Review page at /monthly-review", async ({ page }) => {
    await page.goto("/monthly-review");
    await expect(page.getByRole("heading", { name: "Saffron Wealth 💰" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Monthly Review" })).toBeVisible();
  });

  test("shows the saffron brand mark at the top of the sidebar", async ({ page }) => {
    await page.goto("/monthly-review");
    const brand = page.getByRole("img", { name: "Saffron Wealth" });
    await expect(brand).toBeVisible();
    await expect(brand).toHaveAttribute("src", /saffron\.jpg/);
  });

  test("top header stays visible on scroll", async ({ page }) => {
    await page.goto("/monthly-review");
    const header = page.getByRole("heading", { name: "Saffron Wealth 💰" });
    await expect(header).toBeVisible();
    await page.mouse.wheel(0, 1500);
    await expect(header).toBeInViewport();
  });
});

test.describe("Sidebar navigation", () => {
  test("navigates between Monthly Review and Transactions", async ({ page }) => {
    await page.goto("/monthly-review");
    await expect(page).toHaveURL("/monthly-review");

    await page.getByRole("link", { name: /Transactions/ }).click();
    await expect(page).toHaveURL("/transactions");
    await expect(page.getByRole("heading", { name: "Transactions" })).toBeVisible();

    await page.getByRole("link", { name: /Monthly Review/ }).click();
    await expect(page).toHaveURL("/monthly-review");
    await expect(page.getByRole("heading", { name: "Monthly Review" })).toBeVisible();
  });

  test("marks the active route with aria-current", async ({ page }) => {
    await page.goto("/transactions");
    const txLink = page.getByRole("link", { name: /Transactions/ });
    await expect(txLink).toHaveAttribute("aria-current", "page");

    const reviewLink = page.getByRole("link", { name: /Monthly Review/ });
    await expect(reviewLink).not.toHaveAttribute("aria-current", "page");
  });
});

test.describe("Alerts popover", () => {
  test("opens on click and closes on Escape", async ({ page }) => {
    await page.goto("/monthly-review");
    const bell = page.getByRole("button", { name: /budget alert/ });
    await bell.click();
    const popover = page.getByRole("dialog", { name: "Budget alerts" });
    await expect(popover).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(popover).not.toBeVisible();
  });

  test("closes on click outside", async ({ page }) => {
    await page.goto("/monthly-review");
    await page.getByRole("button", { name: /budget alert/ }).click();
    const popover = page.getByRole("dialog", { name: "Budget alerts" });
    await expect(popover).toBeVisible();

    // Click on the page heading (definitely outside the popover)
    await page.getByRole("heading", { name: "Saffron Wealth 💰" }).click();
    await expect(popover).not.toBeVisible();
  });
});

test.describe("Transactions: add + filter", () => {
  test("adds a new transaction and shows it in the list", async ({ page }) => {
    await page.goto("/transactions");
    await page.getByRole("button", { name: "+ Add Transaction" }).click();

    await page.getByLabel("Description").fill("Smoke test latte");
    await page.getByLabel("Amount").fill("4.25");
    await page.getByRole("button", { name: "Save Transaction" }).click();

    // Form collapses; new entry appears in the list
    await expect(page.getByText("Smoke test latte")).toBeVisible();
    await expect(page.getByText("-$4.25")).toBeVisible();
  });

  test("a new transaction survives a full page reload (real Postgres persistence, Phase 2a)", async ({ page }) => {
    await page.goto("/transactions");
    await page.getByRole("button", { name: "+ Add Transaction" }).click();

    await page.getByLabel("Description").fill("Persistence check");
    await page.getByLabel("Amount").fill("12.34");
    await page.getByRole("button", { name: "Save Transaction" }).click();
    await expect(page.getByText("Persistence check")).toBeVisible();

    // Unlike the old in-memory mock (which reset on every load), this must
    // still be there after a real reload — proof the write actually landed
    // in Postgres rather than only in React state.
    await page.reload();
    await expect(page.getByText("Persistence check")).toBeVisible();
    await expect(page.getByText("-$12.34")).toBeVisible();
  });

  test("edits a transaction and the change survives a reload", async ({ page }) => {
    const original = `Edit me ${Date.now()}`;
    const edited = `${original} (edited)`;
    await page.goto("/transactions");
    await page.getByRole("button", { name: "+ Add Transaction" }).click();
    await page.getByLabel("Description").fill(original);
    await page.getByLabel("Amount").fill("20");
    await page.getByRole("button", { name: "Save Transaction" }).click();
    await expect(page.getByText(original)).toBeVisible();

    await page.getByRole("button", { name: `Edit ${original}` }).click();
    const modal = page.getByRole("dialog", { name: "Edit Transaction" });
    await expect(modal.getByLabel("Description")).toHaveValue(original);
    await modal.getByLabel("Description").fill(edited);
    await modal.getByLabel("Amount").fill("1234.56");
    await modal.getByRole("button", { name: "Save Changes" }).click();
    await expect(modal).not.toBeVisible();

    const row = page.locator("li", { hasText: edited });
    await expect(row).toBeVisible();
    await expect(row.getByText("-$1,234.56")).toBeVisible();

    await page.reload();
    await expect(page.locator("li", { hasText: edited }).getByText("-$1,234.56")).toBeVisible();
    await expect(page.getByText(original, { exact: true })).toHaveCount(0);
  });

  test("filters by search text (description match)", async ({ page }) => {
    await page.goto("/transactions");
    await page.getByLabel("Search").fill("Netflix");

    // Mock data has at least one Netflix transaction
    await expect(page.getByText("Netflix").first()).toBeVisible();
    // A non-matching seeded transaction should be filtered out
    await expect(page.getByText("Whole Foods")).toHaveCount(0);
  });

  test("filters by type (Income only)", async ({ page }) => {
    await page.goto("/transactions");
    await page.getByLabel("Type").selectOption("Income");

    // Income rows visible, expense rows gone
    await expect(page.getByText("Salary").first()).toBeVisible();
    await expect(page.getByText("Whole Foods")).toHaveCount(0);
  });

  test("filters by category chip (Groceries)", async ({ page }) => {
    await page.goto("/transactions");
    await page.getByRole("button", { name: /^Groceries$/ }).click();

    await expect(page.getByText("Whole Foods").first()).toBeVisible();
    await expect(page.getByText("Rent")).toHaveCount(0);
  });

  test("filters by amount range and resets", async ({ page }) => {
    await page.goto("/transactions");
    await page.getByLabel("Min ($)").fill("1000");

    await expect(page.getByText("Salary").first()).toBeVisible();
    await expect(page.getByText("Coffee shop x4")).toHaveCount(0);

    await page.getByRole("button", { name: "Reset filters" }).click();
    await expect(page.getByText("Coffee shop x4")).toBeVisible();
  });
});

test.describe("Setting a monthly budget", () => {
  test("updates an existing category budget via the BudgetEditModal", async ({ page }) => {
    await page.goto("/monthly-review");
    // The budget rows live on the Budget tab; Cashflow is the default.
    await page.getByRole("button", { name: /^budget$/i }).click();

    // Open the edit modal for Groceries (a budgeted category in mock data — $400)
    await page.getByRole("button", { name: /Groceries/ }).first().click();

    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible();
    await expect(modal.getByRole("heading", { name: "Groceries" })).toBeVisible();

    // Update the amount and save
    const input = modal.getByLabel("Monthly budget amount");
    await input.fill("550");
    await modal.getByRole("button", { name: "Save Budget" }).click();

    await expect(modal).not.toBeVisible();
    // The Groceries row now reflects the new budget amount
    await expect(page.getByText(/\/\s*\$550/).first()).toBeVisible();
  });

  test("Use this → applies the historical average suggestion", async ({ page }) => {
    await page.goto("/monthly-review");
    // The budget rows live on the Budget tab; Cashflow is the default.
    await page.getByRole("button", { name: /^budget$/i }).click();
    await page.getByRole("button", { name: /Groceries/ }).first().click();

    const modal = page.getByRole("dialog");
    const input = modal.getByLabel("Monthly budget amount");
    const before = await input.inputValue();

    await modal.getByRole("button", { name: "Use this →" }).click();
    const after = await input.inputValue();
    expect(after).not.toBe(before);
    expect(Number(after)).toBeGreaterThan(0);

    // Cancel — we're only testing that the suggestion populates the input
    await modal.getByRole("button", { name: "Cancel" }).click();
    await expect(modal).not.toBeVisible();
  });
});

test.describe("Monthly Review → Transactions", () => {
  test("a cashflow category opens the Transactions page filtered to it and the month", async ({ page }) => {
    await page.goto("/monthly-review");
    // The seeded spending is in February 2026.
    const prev = page.getByRole("button", { name: "Previous month" });
    while (!(await page.getByText("February 2026").isVisible())) {
      await prev.click();
    }

    await page.getByRole("link", { name: /Groceries/ }).click();

    await expect(page).toHaveURL(/\/transactions\?/);
    await expect(page.getByLabel("From", { exact: true })).toHaveValue("2026-02-01");
    await expect(page.getByLabel("To", { exact: true })).toHaveValue("2026-02-28");
    await expect(page.getByText("Whole Foods")).toBeVisible();
    await expect(page.getByText("Trader Joe's")).toBeVisible();
    // Every row on the page is a February grocery.
    const sublines = await page.locator("ul li button p.text-xs").allInnerTexts();
    expect(sublines.length).toBeGreaterThan(0);
    for (const line of sublines) expect(line).toMatch(/^Groceries · 2026-02-/);
  });
});
