import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { THEME_TOKENS, hexToChannels } from "../lib/theme-tokens";
import { THEME_COOKIE } from "../lib/theme";

function rgb(hex: string): string {
  const [r, g, b] = hexToChannels(hex).split(" ");
  return `rgb(${r}, ${g}, ${b})`;
}

const bodyBackground = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

async function setThemeCookie(page: Page, value: string) {
  await page.context().addCookies([
    { name: THEME_COOKIE, value, domain: "localhost", path: "/", sameSite: "Lax" },
  ]);
}

test.describe("Theme", () => {
  test("with no preference, follows a dark OS", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    await expect(page.locator("html")).not.toHaveAttribute("data-theme");
    expect(await bodyBackground(page)).toBe(rgb(THEME_TOKENS.dark.surface));
  });

  test("with no preference, follows a light OS", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    expect(await bodyBackground(page)).toBe(rgb(THEME_TOKENS.light.surface));
  });

  test("an explicit Light preference overrides a dark OS", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await setThemeCookie(page, "light");
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await bodyBackground(page)).toBe(rgb(THEME_TOKENS.light.surface));
  });

  test("choosing Dark on the profile page applies at once and is in the server's first render after reload", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/profile");

    await page.getByRole("radio", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await bodyBackground(page)).toBe(rgb(THEME_TOKENS.dark.surface));

    // The server, not client JS, sets the attribute — that is what keeps a
    // reload from flashing light first.
    const html = await (await page.request.get("/profile")).text();
    expect(html).toMatch(/<html[^>]*data-theme="dark"/);

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
  });

  test("choosing System clears the override", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await setThemeCookie(page, "dark");
    await page.goto("/profile");
    await page.getByRole("radio", { name: "System" }).click();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme");
    expect(await bodyBackground(page)).toBe(rgb(THEME_TOKENS.light.surface));
  });
});
