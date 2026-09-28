import { test as authed, expect } from "./fixtures";
import { test as anon } from "@playwright/test";

// Item 5. Two jobs here:
//
//   1. Assert the five security headers are actually present, on pages AND on
//      API responses.
//   2. Collect CSP violations across every surface. The acceptance criteria
//      read as a manual console sweep; doing it in Playwright instead means a
//      directive that breaks a page later fails the build rather than waiting
//      to be noticed.

const EXPECTED_HEADERS: [string, RegExp][] = [
  ["x-frame-options", /^DENY$/i],
  ["x-content-type-options", /^nosniff$/i],
  ["referrer-policy", /^strict-origin-when-cross-origin$/i],
  ["permissions-policy", /camera=\(\)/],
];

// The CSP was developed report-only, which is how the inline-script problem
// was found. It is enforcing now, so this reads the enforcing header ONLY —
// a silent slip back to report-only would leave every assertion below passing
// against a policy that no longer blocks anything.
function cspHeader(headers: Record<string, string>): string | undefined {
  expect(
    headers["content-security-policy-report-only"],
    "CSP must be enforcing, not report-only",
  ).toBeUndefined();
  return headers["content-security-policy"];
}

/**
 * Collects CSP violations reported by the browser while `visit` runs.
 *
 * Report-only violations surface as console errors, not exceptions, so nothing
 * fails on its own — they have to be gathered deliberately.
 */
async function collectCspViolations(
  page: import("@playwright/test").Page,
  visit: () => Promise<void>,
): Promise<string[]> {
  const violations: string[] = [];
  page.on("console", msg => {
    const text = msg.text();
    if (/Content.Security.Policy/i.test(text)) violations.push(text);
  });
  // Chromium also emits a structured event for blocked resources.
  page.on("pageerror", e => {
    if (/Content.Security.Policy/i.test(e.message)) violations.push(e.message);
  });
  await visit();
  return violations;
}

anon.describe("Security headers on unauthenticated surfaces", () => {
  const paths = ["/login", "/register", "/password-reset"];

  for (const path of paths) {
    anon(`sets every security header on ${path}`, async ({ page }) => {
      const res = await page.goto(path);
      expect(res).not.toBeNull();
      const headers = res!.headers();

      for (const [name, pattern] of EXPECTED_HEADERS) {
        expect(headers[name], `${name} on ${path}`).toMatch(pattern);
      }
      expect(cspHeader(headers), `CSP on ${path}`).toBeTruthy();
    });
  }

  anon("sets the headers on API responses too", async ({ request }) => {
    // An API response renders nothing, but can still be framed or sniffed.
    const res = await request.get("/api/profile");
    const headers = res.headers();
    for (const [name, pattern] of EXPECTED_HEADERS) {
      expect(headers[name], `${name} on /api/profile`).toMatch(pattern);
    }
    expect(cspHeader(headers)).toBeTruthy();
  });

  anon("declares frame-ancestors 'none' alongside X-Frame-Options", async ({ page }) => {
    const res = await page.goto("/login");
    const csp = cspHeader(res!.headers()) ?? "";
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });

  anon("does not allow inline or eval'd script in the built app", async ({ page }) => {
    const res = await page.goto("/login");
    const csp = cspHeader(res!.headers()) ?? "";
    const scriptSrc = csp.split(";").find(d => d.trim().startsWith("script-src")) ?? "";
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  for (const path of paths) {
    anon(`reports no CSP violations on ${path}`, async ({ page }) => {
      const violations = await collectCspViolations(page, async () => {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
      });
      expect(violations, `CSP violations on ${path}`).toEqual([]);
    });
  }
});

authed.describe("Security headers on authenticated surfaces", () => {
  const paths = ["/", "/transactions", "/net-worth", "/profile"];

  for (const path of paths) {
    authed(`sets every security header on ${path}`, async ({ page }) => {
      const res = await page.goto(path);
      const headers = res!.headers();
      for (const [name, pattern] of EXPECTED_HEADERS) {
        expect(headers[name], `${name} on ${path}`).toMatch(pattern);
      }
      expect(cspHeader(headers), `CSP on ${path}`).toBeTruthy();
    });

    authed(`reports no CSP violations on ${path}`, async ({ page }) => {
      const violations = await collectCspViolations(page, async () => {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
      });
      expect(violations, `CSP violations on ${path}`).toEqual([]);
    });
  }

  authed("renders the net-worth chart without tripping the CSP", async ({ page }) => {
    // The chart is hand-rolled inline SVG — the most likely thing a tight
    // style-src would break.
    const violations = await collectCspViolations(page, async () => {
      await page.goto("/net-worth");
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("heading", { name: /net worth/i }).first()).toBeVisible();
    });
    expect(violations).toEqual([]);
  });

  authed("permits avatar images from Vercel Blob and Google", async ({ page }) => {
    const res = await page.goto("/profile");
    const csp = cspHeader(res!.headers()) ?? "";
    const imgSrc = csp.split(";").find(d => d.trim().startsWith("img-src")) ?? "";
    // Avatars are stored as remote URLs and rendered `unoptimized`, so the
    // browser fetches them cross-origin.
    expect(imgSrc).toContain("blob.vercel-storage.com");
    expect(imgSrc).toContain("lh3.googleusercontent.com");
  });
});
