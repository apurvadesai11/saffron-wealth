import { test, expect } from "@playwright/test";

// State is in-memory and resets on every page load — each test starts fresh.

test.describe("App shell", () => {
  test("loads the Monthly Review page at /", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Saffron Wealth 💰" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Monthly Review" })).toBeVisible();
  });

  test("shows the saffron brand mark at the top of the sidebar", async ({ page }) => {
    await page.goto("/");
    const brand = page.getByRole("img", { name: "Saffron Wealth" });
    await expect(brand).toBeVisible();
    await expect(brand).toHaveAttribute("src", /saffron\.jpg/);
  });

  test("top header stays visible on scroll", async ({ page }) => {
    await page.goto("/");
    const header = page.getByRole("heading", { name: "Saffron Wealth 💰" });
    await expect(header).toBeVisible();
    await page.mouse.wheel(0, 1500);
    await expect(header).toBeInViewport();
  });
});

test.describe("Sidebar navigation", () => {
  test("navigates between Monthly Review and Transactions", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL("/");

    await page.getByRole("link", { name: /Transactions/ }).click();
    await expect(page).toHaveURL("/transactions");
    await expect(page.getByRole("heading", { name: "Transactions" })).toBeVisible();

    await page.getByRole("link", { name: /Monthly Review/ }).click();
    await expect(page).toHaveURL("/");
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
    await page.goto("/");
    const bell = page.getByRole("button", { name: /budget alert/ });
    await bell.click();
    const popover = page.getByRole("dialog", { name: "Budget alerts" });
    await expect(popover).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(popover).not.toBeVisible();
  });

  test("closes on click outside", async ({ page }) => {
    await page.goto("/");
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
    await page.goto("/");

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
    await page.goto("/");
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
