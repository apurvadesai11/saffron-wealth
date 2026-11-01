import { test, expect } from "./fixtures";
import { prisma } from "../lib/prisma";
import { createAccount } from "../lib/accounts";
import { saveFinancialProfile } from "../lib/financial-profile";

// The worker-scoped user is shared with every other spec in the worker (and
// other specs leave accounts behind), so this spec asserts on what the levers
// do to the FI number rather than on the portfolio total, and removes the
// profile versions and accounts it created. Synthetic, invented data only (see
// CLAUDE.md's privacy rule).

// A profile whose only income is RSUs. RSUs are not cash income, so the page
// has no bank deposits to infer a tax rate from and always opens on the tax
// prompt. That also keeps the spec independent of today's date: the seeded
// transactions are fixed in early 2026, and a derived rate would depend on how
// many months ago that was.
const RSU_ONLY_PROFILE = {
  age: 35,
  targetRetirementAge: 55,
  expectedRealReturnPct: 5,
  safeWithdrawalRatePct: 4,
  inflationPct: 2.5,
  filingStatus: null,
  employerMatch: null,
  incomeStreams: [{ kind: "rsu" as const, label: null, annualAmount: 60000, frequency: "quarterly" as const }],
  contributionTargets: [],
};

test.describe("FIRE calculator page", () => {
  const accountIds: string[] = [];

  test.afterEach(async ({ authedUser }) => {
    await prisma.financialProfile.deleteMany({ where: { userId: authedUser.id } });
    await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
    accountIds.length = 0;
  });

  test("asks for a tax rate, then moves the FI number with the withdrawal rate", async ({
    page,
    authedUser,
  }) => {
    await saveFinancialProfile(authedUser.id, RSU_ONLY_PROFILE);
    const brokerage = await createAccount(authedUser.id, {
      name: `E2E FIRE Brokerage ${Date.now()}`, type: "brokerage", institution: null, balance: 250000,
    });
    const card = await createAccount(authedUser.id, {
      name: `E2E FIRE Card ${Date.now()}`, type: "credit_card", institution: null, balance: 2000,
    });
    accountIds.push(brokerage.id, card.id);

    await page.goto("/");
    await page.getByRole("link", { name: "FIRE", exact: true }).click();
    await expect(page).toHaveURL("/fire");
    await expect(page.getByRole("heading", { name: "FIRE Calculator", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "FIRE", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );

    // Nothing is computed before there is a rate; the page asks for one. The
    // rate commits on submit, so a keystroke on the way to "25" does nothing.
    const fiCard = page.getByRole("region", { name: "FI number", exact: true });
    await expect(fiCard).toHaveCount(0);
    await page.getByLabel("Effective tax rate (%)").fill("25");
    await page.getByRole("button", { name: "Calculate" }).click();

    // exact: "Coast FI number" is a second region whose name contains this one.
    await expect(fiCard).toBeVisible();
    // Whole dollars: the headline drops the cents so the figure fits its card.
    const fiFigure = fiCard.getByText(/^\$[\d,]+$/);
    await expect(fiFigure).toBeVisible();
    const startingFi = await fiFigure.textContent();

    // A lower withdrawal rate needs a bigger pot. ArrowLeft is one step down
    // on a native range input.
    const withdrawal = page.getByRole("slider", { name: "Safe withdrawal rate" });
    await withdrawal.focus();
    await withdrawal.press("ArrowLeft");
    await expect(fiFigure).not.toHaveText(startingFi!);
    await expect(withdrawal.locator("xpath=..")).toHaveAttribute("data-modified", "true");

    // The chart's two views are tabs over the same simulation.
    await page.getByRole("tab", { name: "Coast FI" }).click();
    await expect(page.getByRole("tab", { name: "Coast FI" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByText(/of historical starts are already Coast FI/)).toBeVisible();
    await page.getByRole("tab", { name: "Years to FI" }).click();
    await expect(page.getByText(/of historical starts reach FI by your target age/)).toBeVisible();

    // Reset goes back to the starting point. The data had no tax rate to offer,
    // so the rate typed above became part of that starting point: Reset keeps
    // it rather than asking again (components/FireCalculatorClient.test.tsx
    // pins this), and only the withdrawal rate moves back.
    await page.getByRole("button", { name: "Reset to defaults" }).click();
    await expect(fiFigure).toHaveText(startingFi!);
    await expect(page.getByLabel("Effective tax rate (%)")).toHaveCount(0);
    await expect(page.getByRole("slider", { name: "Effective tax rate" })).toHaveValue("25");
    await expect(withdrawal.locator("xpath=..")).toHaveAttribute("data-modified", "false");
  });
});
