import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildGoogleAuthorizeUrl,
  exchangeGoogleCode,
  fetchGoogleProfile,
} from "./google-oauth";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env.GOOGLE_CLIENT_ID = originalEnv.GOOGLE_CLIENT_ID;
  process.env.GOOGLE_CLIENT_SECRET = originalEnv.GOOGLE_CLIENT_SECRET;
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

  it("throws when GOOGLE_CLIENT_ID is missing", () => {
    delete process.env.GOOGLE_CLIENT_ID;
    expect(() => buildGoogleAuthorizeUrl("s", "https://x")).toThrow(
      /GOOGLE_CLIENT_ID/,
    );
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
