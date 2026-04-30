import { test, expect } from "@playwright/test";

// These tests verify the proxy-level redirect behavior. No DB or session
// table is required because proxy.ts does a cheap shape check only.

test.describe("Auth proxy gating", () => {
  test("redirects unauthenticated visitors at / to /login with next param", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login\?next=%2F$/);
  });

  test("redirects unauthenticated visitors at /transactions to /login with next param", async ({ page }) => {
    await page.goto("/transactions");
    await expect(page).toHaveURL(/\/login\?next=%2Ftransactions$/);
  });

  test("redirects unauthenticated visitors at /profile to /login with next param", async ({ page }) => {
    await page.goto("/profile");
    await expect(page).toHaveURL(/\/login\?next=%2Fprofile$/);
  });

  test("rejects malformed session cookies (too short) and redirects", async ({ page, context }) => {
    await context.addCookies([
      {
        name: "sw_session",
        value: "short",
        domain: "localhost",
        path: "/",
        sameSite: "Lax",
      },
    ]);
    await page.goto("/transactions");
    await expect(page).toHaveURL(/\/login/);
  });

  test("/login is accessible without a session and fully renders", async ({ page }) => {
    await page.goto("/login");
    // Heading proves the page rendered (not stuck on Suspense "Loading…" fallback).
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    // Form fields and submit button prove JS hydrated — they only exist after
    // the client-side LoginForm mounts (the SSR output is just "Loading…").
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });

  test("/register is accessible without a session and fully renders", async ({ page }) => {
    await page.goto("/register");
    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
  });

  test("/password-reset is accessible without a session and fully renders", async ({ page }) => {
    await page.goto("/password-reset");
    await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByRole("button", { name: /send/i })).toBeVisible();
  });

  test("a session cookie matching the shape regex passes the proxy", async ({ page, context }) => {
    await context.addCookies([
      {
        name: "sw_session",
        value: "e2e_test_fake_session_cookie_42chars_aabbcc",
        domain: "localhost",
        path: "/",
        sameSite: "Lax",
      },
    ]);
    await page.goto("/");
    // Reaches the actual page (no redirect to /login).
    await expect(page).toHaveURL("/");
  });
});
