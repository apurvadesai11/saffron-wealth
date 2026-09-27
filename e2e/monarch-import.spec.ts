import { join } from "node:path";
import { test, expect } from "./fixtures";

// Reuses Task 3's synthetic fixture (app/api/transactions/__tests__/fixtures/
// monarch-transactions-sample.csv) rather than authoring a second one — it's
// already the vetted synthetic dataset for this exact import pipeline (see
// CLAUDE.md's real-data ban), and .gitignore only allows *.csv under a
// __tests__/fixtures/ directory anyway.
const FIXTURE_PATH = join(
  process.cwd(),
  "app/api/transactions/__tests__/fixtures/monarch-transactions-sample.csv",
);

// A second, disjoint fixture (distinct externalHash from the first, so this
// test's import is never treated as a duplicate) — needed because the
// regression test below needs an import whose rows are genuinely new, on
// top of the worker's own already-committed history from the first test.
const FIXTURE_PATH_2 = join(
  process.cwd(),
  "app/api/transactions/__tests__/fixtures/monarch-transactions-sample-2.csv",
);

// Each test imports a different fixture, deliberately — the worker's authed
// user persists across tests (see net-worth.spec.ts's note on real Postgres
// state), and re-committing the same file a second time would only find
// duplicates, which is a different scenario than either test here.
test.describe("Monarch import", () => {
  test("previews a CSV, confirms the import, and the imported rows appear", async ({ page }) => {
    await page.goto("/transactions");
    await page.getByRole("button", { name: "Import from Monarch" }).click();

    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible();

    await modal.getByLabel("Monarch transactions CSV").setInputFiles(FIXTURE_PATH);

    // Preview summary appears. The worker's seeded MOCK_CATEGORIES already
    // has Groceries/Salary/Transport, so accounts (never seeded for this
    // user) are the reliable "definitely new" signal; date range is stable
    // regardless of prior category state.
    await expect(modal).toHaveAttribute("data-import-step", "preview");
    await expect(modal.getByText("2026-01-05 – 2026-01-15")).toBeVisible();
    await expect(modal.getByText("Everyday Checking")).toBeVisible();
    await expect(modal.getByText("Sunset Credit Card")).toBeVisible();
    await expect(modal.getByText("Travel Card, Signature")).toBeVisible();

    await modal.getByRole("button", { name: "Confirm import" }).click();

    await expect(modal).toHaveAttribute("data-import-step", "success");
    await expect(modal.getByText(/Imported/)).toBeVisible();

    await modal.getByRole("button", { name: "Done" }).click();
    await expect(modal).not.toBeVisible();

    // router.refresh() re-fetches transactions/categories server-side after
    // commit; the newly imported rows (identified by their merchant name,
    // per lib/transaction-import.ts's description fallback chain) should now
    // render in the list without a manual page reload.
    await expect(page.getByText("Fresh Grocer")).toBeVisible();
    await expect(page.getByText("Initech Payroll")).toBeVisible();
    await expect(page.getByText("City Cab Co")).toBeVisible();
  });

  // Reproduces the exact shape the guard in lib/app-context.tsx exists to
  // handle: a local mutation (unrelated to the import) that happened BEFORE
  // the import was even opened, not one that races the refresh. A guard that
  // compares the mutation count against "last seed change" instead of
  // "when this refresh was requested" treats that earlier, unrelated add as
  // a race and drops the import's own data — the regression a prior fix
  // round introduced and this test is here to catch.
  test("a transaction added before opening the import still lets the import's own rows appear", async ({ page }) => {
    await page.goto("/transactions");

    const description = `Pre-import add ${Date.now()}`;
    await page.getByRole("button", { name: "+ Add Transaction" }).click();
    await page.getByLabel("Description").fill(description);
    await page.getByLabel("Amount").fill("7.50");
    await page.getByRole("button", { name: "Save Transaction" }).click();
    await expect(page.getByText(description)).toBeVisible();

    await page.getByRole("button", { name: "Import from Monarch" }).click();
    const modal = page.getByRole("dialog");
    await modal.getByLabel("Monarch transactions CSV").setInputFiles(FIXTURE_PATH_2);
    await expect(modal).toHaveAttribute("data-import-step", "preview");

    await modal.getByRole("button", { name: "Confirm import" }).click();
    await expect(modal).toHaveAttribute("data-import-step", "success");
    await modal.getByRole("button", { name: "Done" }).click();
    await expect(modal).not.toBeVisible();

    // The import's own new data must actually appear post-refresh — not
    // just the earlier, already-visible local add.
    await expect(page.getByText("Second Coffee Co")).toBeVisible();
    // And the earlier, unrelated mutation must still be there too.
    await expect(page.getByText(description)).toBeVisible();
  });
});
