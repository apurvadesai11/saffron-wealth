import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { prisma } from "../lib/prisma";
import { createAccount } from "../lib/accounts";

// The worker-scoped user is shared with every other spec in the worker, so
// this spec reads version numbers off the page instead of assuming it saves
// version 1, and removes the account and profile versions it created.
// Synthetic, invented data only (see CLAUDE.md's privacy rule).

async function saveAndReadVersion(page: Page): Promise<number> {
  await page.getByRole("button", { name: "Save profile" }).click();
  const status = page.getByRole("status");
  await expect(status).toHaveText(/^Saved as version \d+\.$/);
  return Number((await status.textContent())!.match(/\d+/)![0]);
}

test.describe("Financial Profile page", () => {
  let accountId: string | undefined;

  test.afterEach(async ({ authedUser }) => {
    await prisma.financialProfile.deleteMany({ where: { userId: authedUser.id } });
    if (accountId) await prisma.account.delete({ where: { id: accountId } }).catch(() => {});
    accountId = undefined;
  });

  test("declares a profile, keeps it across a reload, and versions each change", async ({
    page,
    authedUser,
  }) => {
    const accountName = `E2E Roth ${Date.now()}`;
    const account = await createAccount(authedUser.id, {
      name: accountName, type: "roth_ira", institution: null, balance: 1000,
    });
    accountId = account.id;

    await page.goto("/");
    await page.getByRole("link", { name: /Financial Profile/ }).click();
    await expect(page).toHaveURL("/financial-profile");
    await expect(page.getByRole("heading", { name: "Financial Profile" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Financial Profile/ })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await page.getByLabel("Current age").fill("34");
    await page.getByLabel("Target retirement age").fill("50");
    await page.getByLabel("Filing status").selectOption("single");
    await page.getByLabel("Income 1 annual amount").fill("90,000");
    await page.getByRole("button", { name: "+ Add income" }).click();
    await page.getByLabel("Income 2 type").selectOption("rsu");
    await page.getByLabel("Income 2 annual amount").fill("20000");
    await expect(page.getByTestId("income-total")).toHaveText("$110,000.00");
    await page.getByLabel("Expected real return").fill("5");
    await page.getByLabel("Safe withdrawal rate").fill("3.5");
    await page.getByLabel("Inflation").fill("2.5");
    await page.getByRole("button", { name: "+ Add contribution target" }).click();
    await page.getByLabel("Contribution 1 account").selectOption({ label: accountName });
    await page.getByLabel("Contribution 1 annual amount").fill("7000");

    const first = await saveAndReadVersion(page);
    await expect(page.getByText(new RegExp(`^Version ${first} · saved`))).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Current age")).toHaveValue("34");
    await expect(page.getByLabel("Income 2 type")).toHaveValue("rsu");
    await expect(page.getByLabel("Income 2 frequency")).toHaveValue("quarterly");
    await expect(page.getByLabel("Inflation")).toHaveValue("2.5");
    await expect(page.getByLabel("Contribution 1 account")).toHaveValue(account.id);

    await page.getByLabel("Inflation").fill("3");
    expect(await saveAndReadVersion(page)).toBe(first + 1);

    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByRole("status")).toHaveText("No changes to save.");
  });

  test("shows field errors without saving when a required field is blank", async ({
    page,
    authedUser,
  }) => {
    await page.goto("/financial-profile");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByLabel("Current age")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("Please correct the errors and try again.")).toBeVisible();
    expect(await prisma.financialProfile.count({ where: { userId: authedUser.id } })).toBe(0);
  });
});
