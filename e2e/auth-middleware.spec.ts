import { test, expect } from "@playwright/test";
import { prisma } from "../lib/prisma";
import { hashPassword } from "../lib/auth/password";

// These tests verify end-to-end auth gating across the proxy AND the (app)
// server layout. The proxy does a cheap cookie-shape check; the (app) layout
// does the real DB-backed validation. A forged cookie that passes the shape
// check must still be rejected by the layout (which fails closed if the DB
// is unreachable).

test.describe("Auth gating", () => {
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

  test("a forged shape-valid cookie passes the proxy but is rejected by the (app) layout", async ({ page, context }) => {
    // This cookie matches the proxy's shape regex but does not correspond to a
    // real session row. The proxy lets it through (cheap edge check), but
    // (app)/layout.tsx must call getSession() and redirect on null.
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
    await expect(page).toHaveURL(/\/login(\?|$)/);
  });

  test("forged cookie cannot reach /transactions either", async ({ page, context }) => {
    await context.addCookies([
      {
        name: "sw_session",
        value: "e2e_test_fake_session_cookie_42chars_aabbcc",
        domain: "localhost",
        path: "/",
        sameSite: "Lax",
      },
    ]);
    await page.goto("/transactions");
    await expect(page).toHaveURL(/\/login(\?|$)/);
  });
});

// Item 1 — the post-sign-in redirect must stay on-origin. `?next=` is set
// legitimately by proxy.ts, so a hostile value is indistinguishable by shape;
// safeNext() narrows it to a site-relative path before router.push() sees it.
test.describe("Post-sign-in redirect is same-origin", () => {
  const password = "e2e-redirect-pw-9182";
  let email: string;
  let userId: string;

  test.beforeAll(async () => {
    email = `e2e-redirect-${Date.now()}@example.test`;
    const user = await prisma.user.create({
      data: {
        email,
        emailNormalized: email.toLowerCase(),
        firstName: "Redirect",
        lastName: "Probe",
        passwordHash: await hashPassword(password),
      },
      select: { id: true },
    });
    userId = user.id;
  });

  test.afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  });

  async function signInWithNext(page: import("@playwright/test").Page, next: string) {
    await page.goto(`/login?next=${encodeURIComponent(next)}`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    // Wait for the client-side navigation away from /login to settle.
    await page.waitForURL(url => !url.pathname.startsWith("/login"), { timeout: 15_000 });
  }

  test("an absolute off-origin next lands on /", async ({ page }) => {
    await signInWithNext(page, "https://evil.example");
    expect(new URL(page.url()).origin).toBe("http://localhost:3100");
    await expect(page).toHaveURL("http://localhost:3100/");
  });

  test("a protocol-relative next lands on /", async ({ page }) => {
    await signInWithNext(page, "//evil.example");
    expect(new URL(page.url()).origin).toBe("http://localhost:3100");
    await expect(page).toHaveURL("http://localhost:3100/");
  });

  test("a site-relative next is still honored", async ({ page }) => {
    await signInWithNext(page, "/transactions");
    await expect(page).toHaveURL("http://localhost:3100/transactions");
  });
});
