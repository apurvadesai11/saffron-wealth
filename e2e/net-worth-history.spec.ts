import { join } from "node:path";
import { test, expect } from "./fixtures";

// Synthetic, entirely invented data (no real personal or financial data —
// see CLAUDE.md's privacy rule): two accounts, monthly balances from
// 2024-01-01 to 2026-01-01 (25 distinct dates), neither of which stops
// reporting before the file's own max date, so neither imports archived.
// The long span exists specifically so a narrower chart range (e.g. "3M")
// visibly excludes points a "MAX" range includes.
const RANGE_FIXTURE_PATH = join(
  process.cwd(),
  "app/api/accounts/__tests__/fixtures/balance-history-range-sample.csv",
);

// Reads the dollar figure out of a rendered "$1,234.56"-shaped string.
function parseCurrency(text: string): number {
  return Number(text.replace(/[^0-9.-]/g, ""));
}

test.describe("Net Worth — history chart and balance-history import", () => {
  test("imports balance history, renders the chart, narrows the range, and the chart's latest point matches the summary card", async ({
    page,
  }) => {
    await page.goto("/net-worth");

    await page.getByRole("button", { name: "Import balance history" }).click();
    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible();

    await modal.getByLabel("Monarch balance history CSV").setInputFiles(RANGE_FIXTURE_PATH);
    await expect(modal).toHaveAttribute("data-import-step", "preview");
    await expect(modal.getByText("2024-01-01 – 2026-01-01")).toBeVisible();
    await expect(modal.getByText("Range Test Checking")).toBeVisible();
    await expect(modal.getByText("Range Test Credit Card")).toBeVisible();

    await modal.getByRole("button", { name: "Confirm import" }).click();
    await expect(modal).toHaveAttribute("data-import-step", "success");
    await modal.getByRole("button", { name: "Done" }).click();
    await expect(modal).not.toBeVisible();

    // router.refresh() re-derives accounts + the series server-side; the
    // chart should now render real history instead of the empty state.
    const chartContainer = page.locator("[data-point-count]");
    await expect(chartContainer).not.toHaveAttribute("data-state", "empty");
    const maxCount = Number(await chartContainer.getAttribute("data-point-count"));
    // At least our own 25 imported dates — could be more if this worker's
    // shared test user already has other accounts (deliberately not an
    // exact-count assertion; see e2e/net-worth.spec.ts's own note on shared
    // worker state).
    expect(maxCount).toBeGreaterThanOrEqual(25);

    // Toggling to a narrower range must actually narrow the visible
    // series — MAX always includes every sampled date across every account;
    // a two-year-spanning fixture guarantees a 3-month window excludes most
    // of it regardless of what else this worker's user has accumulated.
    const rangeGroup = page.getByRole("group", { name: "Chart range" });
    await rangeGroup.getByRole("button", { name: "3M", exact: true }).click();
    const narrowedCount = Number(await chartContainer.getAttribute("data-point-count"));
    expect(narrowedCount).toBeLessThan(maxCount);

    // Cross-check: net worth "today" from the chart's last point must equal
    // the summary card, computed independently by lib/account-utils.ts's
    // computeNetWorth. Back to MAX first so the "last point" is genuinely
    // the most recent sample, not clipped by the 3M window above.
    await rangeGroup.getByRole("button", { name: "MAX", exact: true }).click();
    const slider = page.getByRole("slider", { name: "Net worth value explorer" });
    const valueText = await slider.getAttribute("aria-valuetext");
    // aria-valuetext is "{formatted date}: {$currency}" — see NetWorthChart's
    // activeValueText.
    const chartValue = parseCurrency(valueText!.split(":")[1]);

    const netWorthCard = page.locator("[data-net-worth-sign]");
    const cardText = await netWorthCard.locator("p.text-2xl").innerText();
    const cardValue = parseCurrency(cardText);

    // One-cent tolerance: the series rounds per point; computeNetWorth
    // doesn't (see lib/net-worth-history.ts's rounding comment). A larger
    // mismatch would point at a real bug — see the task brief's caveat
    // about NOT restoring unbounded carry-forward to "fix" that.
    expect(Math.abs(chartValue - cardValue)).toBeLessThanOrEqual(0.01);
  });

  test("archiving an account moves it to Archived and excludes it from net worth; restoring returns it to its bucket and the total", async ({
    page,
  }) => {
    const name = `E2E Archive Round Trip ${Date.now()}`;
    const balance = 777;
    await page.goto("/net-worth");

    await page.getByRole("button", { name: "+ Add Account" }).click();
    const modal = page.getByRole("dialog");
    await modal.getByLabel("Account name").fill(name);
    await modal.getByLabel("Type").selectOption("cash");
    await modal.getByLabel("Balance").fill(String(balance));
    await modal.getByRole("button", { name: "Add Account" }).click();
    await expect(modal).not.toBeVisible();
    await expect(page.getByText(name)).toBeVisible();

    const netWorthCard = page.locator("[data-net-worth-sign]");
    const before = parseCurrency(await netWorthCard.locator("p.text-2xl").innerText());

    // Archive (Delete is a soft-archive — lib/accounts.ts's archiveAccount).
    await page.getByRole("button", { name: `Delete ${name}` }).click();
    await expect(page.locator("[data-bucket]").getByText(name)).toHaveCount(0);

    const archivedGroup = page.locator('[data-state="archived-group"]');
    await archivedGroup.locator("summary").click();
    const archivedRow = archivedGroup.locator("li", { hasText: name });
    await expect(archivedRow).toBeVisible();

    // Excluded from totals: the summary card must drop by exactly this
    // account's balance now that it's archived.
    const afterArchive = parseCurrency(await netWorthCard.locator("p.text-2xl").innerText());
    expect(afterArchive).toBeCloseTo(before - balance, 2);

    // Restore: back in its bucket, and counted again.
    await archivedRow.getByRole("button", { name: "Restore" }).click();
    await expect(archivedGroup.getByText(name)).toHaveCount(0);
    await expect(page.locator("[data-bucket]").getByText(name)).toBeVisible();

    const afterRestore = parseCurrency(await netWorthCard.locator("p.text-2xl").innerText());
    expect(afterRestore).toBeCloseTo(before, 2);
  });

  // Regression test for a review finding: archiveAccount (lib/accounts.ts)
  // never writes a closing AccountBalanceEvent, so an account created and
  // archived on the SAME calendar day has its one event (the opening
  // balance, dated "now" at creation) sharing the same date as archivedAt.
  // Pre-fix, lib/net-worth-history.ts's upper-bound check ("date >
  // lastDate") didn't exclude that day, so the chart still counted this
  // account on today's point while the summary card (which excludes
  // archived accounts unconditionally) already didn't — a full-dollar
  // mismatch, not the documented one-cent/overpaid-debt caveat. This test
  // creates the same-day-archived account itself, rather than depending on
  // another test's account already being in that state.
  test("cross-check holds for an account archived the same day it was created", async ({ page }) => {
    const name = `E2E Same-Day Archive ${Date.now()}`;
    const balance = 500;
    await page.goto("/net-worth");

    await page.getByRole("button", { name: "+ Add Account" }).click();
    const modal = page.getByRole("dialog");
    await modal.getByLabel("Account name").fill(name);
    await modal.getByLabel("Type").selectOption("cash");
    await modal.getByLabel("Balance").fill(String(balance));
    await modal.getByRole("button", { name: "Add Account" }).click();
    await expect(modal).not.toBeVisible();
    await expect(page.getByText(name)).toBeVisible();

    // Archive it immediately — same calendar day as creation.
    await page.getByRole("button", { name: `Delete ${name}` }).click();
    await expect(page.locator("[data-bucket]").getByText(name)).toHaveCount(0);

    // Add/delete don't refresh the chart locally (only a committed import
    // does — see NetWorthClient's design note); reload so the series is
    // recomputed server-side from the fresh Postgres state, including this
    // account's event and its same-day archivedAt. Without this reload the
    // chart's `series` prop would still be the one fetched at initial page
    // load, before this account even existed, and the comparison below
    // would prove nothing either way.
    await page.reload();

    const netWorthCard = page.locator("[data-net-worth-sign]");
    const cardValue = parseCurrency(await netWorthCard.locator("p.text-2xl").innerText());

    const slider = page.getByRole("slider", { name: "Net worth value explorer" });
    const valueText = await slider.getAttribute("aria-valuetext");
    const chartValue = parseCurrency(valueText!.split(":")[1]);

    // Pre-fix this would fail by roughly $500 (this account's balance),
    // not by a rounding cent — see the comment above the test.
    expect(Math.abs(chartValue - cardValue)).toBeLessThanOrEqual(0.01);
  });
});
