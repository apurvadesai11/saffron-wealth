import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildGoogleAuthorizeUrl,
  exchangeGoogleCode,
  fetchGoogleProfile,
  googleCallbackRedirectUri,
  googleOauthConfigStatus,
} from "./google-oauth";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

const MANAGED_KEYS = [
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_OAUTH_REDIRECT_URI",
  "APP_BASE_URL",
] as const;

function restoreKey(key: string) {
  const prior = originalEnv[key];
  if (prior === undefined) delete process.env[key];
  else process.env[key] = prior;
}

beforeEach(() => {
  process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";
  delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
  delete process.env.APP_BASE_URL;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of MANAGED_KEYS) restoreKey(key);
});

describe("buildGoogleAuthorizeUrl", () => {
  it("includes the required OAuth parameters", () => {
    const url = buildGoogleAuthorizeUrl("state-abc", "https://app.example/cb");
    const parsed = new URL(url);
    expect(parsed.host).toBe("accounts.google.com");
    expect(parsed.pathname).toBe("/o/oauth2/v2/auth");
    expect(parsed.searchParams.get("client_id")).toBe("test-client-id");
    expect(parsed.searchParams.get("redirect_uri")).toBe("https://app.example/cb");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("scope")).toBe("openid email profile");
    expect(parsed.searchParams.get("state")).toBe("state-abc");
  });

  it("throws when GOOGLE_OAUTH_CLIENT_ID is missing", () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    expect(() => buildGoogleAuthorizeUrl("s", "https://x")).toThrow(
      /GOOGLE_OAUTH_CLIENT_ID/,
    );
  });
});

describe("googleCallbackRedirectUri", () => {
  it("uses GOOGLE_OAUTH_REDIRECT_URI verbatim when set", () => {
    // It has to byte-match what is registered in the Google console, so an
    // explicit value must not be rebuilt from parts.
    process.env.GOOGLE_OAUTH_REDIRECT_URI = "https://registered.example/custom/cb";
    expect(googleCallbackRedirectUri("https://ignored.example/api/x")).toBe(
      "https://registered.example/custom/cb",
    );
  });

  it("derives from APP_BASE_URL when no explicit URI is set", () => {
    process.env.APP_BASE_URL = "https://app.example";
    expect(googleCallbackRedirectUri("https://ignored.example/api/x")).toBe(
      "https://app.example/api/auth/oauth/google/callback",
    );
  });

  it("falls back to the request origin when neither is set", () => {
    expect(googleCallbackRedirectUri("http://localhost:3000/api/auth/oauth/google/start")).toBe(
      "http://localhost:3000/api/auth/oauth/google/callback",
    );
  });

  it("prefers the explicit URI over APP_BASE_URL", () => {
    process.env.APP_BASE_URL = "https://app.example";
    process.env.GOOGLE_OAUTH_REDIRECT_URI = "https://registered.example/cb";
    expect(googleCallbackRedirectUri("https://x.example/y")).toBe(
      "https://registered.example/cb",
    );
  });
});

describe("googleOauthConfigStatus", () => {
  it("reports ok when both id and secret are present", () => {
    expect(googleOauthConfigStatus()).toEqual({ ok: true });
  });

  it("names the missing secret when only the id is set", () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const status = googleOauthConfigStatus();
    expect(status.ok).toBe(false);
    expect(status.ok === false && status.reason).toMatch(/SECRET is missing/);
  });

  it("names the missing id when only the secret is set", () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    const status = googleOauthConfigStatus();
    expect(status.ok).toBe(false);
    expect(status.ok === false && status.reason).toMatch(/CLIENT_ID is missing/);
  });

  it("reports both unset distinctly from a half-configured pair", () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const status = googleOauthConfigStatus();
    expect(status.ok).toBe(false);
    expect(status.ok === false && status.reason).toMatch(/both unset/);
  });
});

describe("exchangeGoogleCode", () => {
  it("posts the code to Google's token endpoint and parses JSON", async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({ access_token: "at", expires_in: 3600 }), {
          headers: { "content-type": "application/json" },
        }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const result = await exchangeGoogleCode("the-code", "https://app.example/cb");
    expect(result.access_token).toBe("at");
    expect(result.expires_in).toBe(3600);

    const calls = (fetchSpy as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    expect(calls[0][0]).toBe("https://oauth2.googleapis.com/token");
    expect(calls[0][1].method).toBe("POST");
    const body = String(calls[0][1].body);
    expect(body).toContain("code=the-code");
    expect(body).toContain("grant_type=authorization_code");
    expect(body).toContain("client_id=test-client-id");
    expect(body).toContain("client_secret=test-client-secret");
  });

  it("throws on non-2xx response", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("bad request", { status: 400 }),
    ) as unknown as typeof fetch;
    await expect(
      exchangeGoogleCode("bad-code", "https://app.example/cb"),
    ).rejects.toThrow();
  });
});

describe("fetchGoogleProfile", () => {
  it("parses well-formed userinfo response", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            sub: "google-user-123",
            email: "alice@example.com",
            email_verified: true,
            given_name: "Alice",
            family_name: "Smith",
            picture: "https://example.com/p.png",
          }),
          { headers: { "content-type": "application/json" } },
        ),
    ) as unknown as typeof fetch;

    const profile = await fetchGoogleProfile("access-token");
    expect(profile.sub).toBe("google-user-123");
    expect(profile.email).toBe("alice@example.com");
    expect(profile.email_verified).toBe(true);
    expect(profile.given_name).toBe("Alice");
    expect(profile.family_name).toBe("Smith");
    expect(profile.picture).toBe("https://example.com/p.png");
  });

  it("treats missing email_verified as false (defensive coercion)", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ sub: "x", email: "y@z.com" }),
          { headers: { "content-type": "application/json" } },
        ),
    ) as unknown as typeof fetch;
    const profile = await fetchGoogleProfile("access-token");
    expect(profile.email_verified).toBe(false);
  });

  it("throws when sub or email missing", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ name: "no sub or email" }), {
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    await expect(fetchGoogleProfile("at")).rejects.toThrow();
  });

  it("throws on non-2xx response", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("unauthorized", { status: 401 }),
    ) as unknown as typeof fetch;
    await expect(fetchGoogleProfile("at")).rejects.toThrow();
  });
});
