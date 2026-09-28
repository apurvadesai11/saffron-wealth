import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";

// Item 14. Two things the plan asks be verified in a real browser rather than
// walked by hand, so they become regressions we keep:
//
//   14c — all four modals had role="dialog" and aria-modal="true" but nothing
//   confining Tab. aria-modal tells a screen reader the rest of the page is
//   inert; it does not make it so, and a sighted keyboard user tabbed straight
//   out of the dialog into the page behind the overlay.
//
//   14b — the archive control's hit target. happy-dom has no layout, so the
//   unit test can only assert the sizing classes; this measures the box the
//   browser actually renders.

/**
 * Tab past the end of the dialog and assert focus never leaves it, then close
 * and assert focus is back on the trigger.
 *
 * `steps` is deliberately larger than any of these dialogs' focusable count,
 * so the walk wraps at least once — the whole point is that there is no exit.
 */
async function assertFocusTrapped(
  page: Page,
  openDialog: () => Promise<void>,
  triggerName: RegExp | string,
  steps = 12,
) {
  const trigger = page.getByRole("button", { name: triggerName });
  await trigger.focus();
  await openDialog();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // Focus starts inside: every one of these modals autofocuses a field.
  await expect(dialog.locator(":focus")).toHaveCount(1);

  for (let i = 0; i < steps; i++) {
    await page.keyboard.press("Tab");
    // The assertion: whatever has focus is still a descendant of the dialog.
    await expect(
      dialog.locator(":focus"),
      `focus escaped the dialog after ${i + 1} Tab press(es)`,
    ).toHaveCount(1);
  }

  // And backwards, which wraps at the other end.
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press("Shift+Tab");
    await expect(
      dialog.locator(":focus"),
      `focus escaped the dialog after ${i + 1} Shift+Tab press(es)`,
    ).toHaveCount(1);
  }

  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();

  // Focus returns to what opened it, rather than being dumped on <body>.
  await expect(trigger).toBeFocused();
}

test.describe("modal focus management", () => {
  test("AccountEditModal traps Tab and restores focus", async ({ page }) => {
    await page.goto("/net-worth");
    await assertFocusTrapped(
      page,
      () => page.getByRole("button", { name: "+ Add Account" }).click(),
      "+ Add Account",
    );
  });

  test("BalanceHistoryImportModal traps Tab and restores focus", async ({ page }) => {
    await page.goto("/net-worth");
    await assertFocusTrapped(
      page,
      () => page.getByRole("button", { name: /Import balance history/ }).click(),
      /Import balance history/,
    );
  });

  test("MonarchImportModal traps Tab and restores focus", async ({ page }) => {
    await page.goto("/transactions");
    await assertFocusTrapped(
      page,
      () => page.getByRole("button", { name: "Import from Monarch" }).click(),
      "Import from Monarch",
    );
  });

  test("BudgetEditModal traps Tab and restores focus", async ({ page }) => {
    await page.goto("/");
    // The budget rows are buttons named after their category.
    const trigger = page.getByRole("button", { name: /Groceries/ }).first();
    await trigger.focus();
    await trigger.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      await expect(
        dialog.locator(":focus"),
        `focus escaped the dialog after ${i + 1} Tab press(es)`,
      ).toHaveCount(1);
    }

    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
  });
});

test.describe("archive control accessibility", () => {
  test("the control is at least 24x24 CSS pixels and confirms before archiving", async ({
    page,
  }) => {
    const name = `E2E A11y Target ${Date.now()}`;
    await page.goto("/net-worth");

    await page.getByRole("button", { name: "+ Add Account" }).click();
    const modal = page.getByRole("dialog");
    await modal.getByLabel("Account name").fill(name);
    await modal.getByLabel("Type").selectOption("cash");
    await modal.getByLabel("Balance").fill("500");
    await modal.getByRole("button", { name: "Add Account" }).click();
    await expect(modal).not.toBeVisible();

    const control = page.getByRole("button", { name: `Archive ${name}` });
    await expect(control).toBeVisible();

    // WCAG 2.1 SC 2.5.8 target minimum. The bare glyph reserved roughly 10px.
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(24);
    expect(box!.height).toBeGreaterThanOrEqual(24);

    // The control's colour, resolved by the browser rather than inferred from
    // a class name. text-gray-500 is rgb(107, 114, 128).
    const color = await control.evaluate((el) => getComputedStyle(el).color);
    expect(color).toBe("rgb(107, 114, 128)");

    // One click asks; it does not archive.
    await control.click();
    await expect(page.getByText("Archive?")).toBeVisible();
    await expect(page.locator("[data-bucket]").getByText(name)).toHaveCount(1);

    // Cancel leaves the account alone.
    await page.getByRole("button", { name: /Cancel/ }).click();
    await expect(page.getByText("Archive?")).not.toBeVisible();
    await expect(page.locator("[data-bucket]").getByText(name)).toHaveCount(1);

    // Confirming archives it.
    await control.click();
    await page.getByRole("button", { name: /^Yes, archive/ }).click();
    await expect(page.locator("[data-bucket]").getByText(name)).toHaveCount(0);
  });
});
