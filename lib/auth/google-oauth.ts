// Manual Google OAuth 2.0 / OIDC client. Replaces what would have been
// Auth.js's GoogleProvider. We do this directly to keep our existing Session
// and OAuthAccount schema (Auth.js's PrismaAdapter expects different field
// shapes).

const AUTHORIZE_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";

export interface GoogleProfile {
  sub: string;
  email: string;
  email_verified: boolean;
  given_name?: string;
  family_name?: string;
  name?: string;
  picture?: string;
}

export interface GoogleTokenResponse {
  access_token?: string;
  id_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

export function buildGoogleAuthorizeUrl(
  state: string,
  redirectUri: string,
): string {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) throw new Error("GOOGLE_OAUTH_CLIENT_ID is not configured");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
    access_type: "online",
  });
  return `${AUTHORIZE_ENDPOINT}?${params.toString()}`;
}

export async function exchangeGoogleCode(
  code: string,
  redirectUri: string,
): Promise<GoogleTokenResponse> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET not configured");
  }
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`google token exchange failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function fetchGoogleProfile(accessToken: string): Promise<GoogleProfile> {
  const res = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`google userinfo fetch failed: ${res.status}`);
  }
  const json = await res.json();
  if (typeof json !== "object" || json === null) {
    throw new Error("google userinfo returned non-object");
  }
  if (typeof json.sub !== "string" || typeof json.email !== "string") {
    throw new Error("google userinfo missing required fields");
  }
  return {
    sub: json.sub,
    email: json.email,
    email_verified: Boolean(json.email_verified),
    given_name: typeof json.given_name === "string" ? json.given_name : undefined,
    family_name: typeof json.family_name === "string" ? json.family_name : undefined,
    name: typeof json.name === "string" ? json.name : undefined,
    picture: typeof json.picture === "string" ? json.picture : undefined,
  };
}

// The redirect_uri sent to Google has to byte-match one registered in the
// Google console. GOOGLE_OAUTH_REDIRECT_URI is that registered value, so it
// wins outright when set; otherwise we derive it from APP_BASE_URL, falling
// back to the request origin for local dev. Deriving it was the only behavior
// before, which made the documented GOOGLE_OAUTH_REDIRECT_URI dead config.
export function googleCallbackRedirectUri(reqUrl: string): string {
  const explicit = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (explicit) return explicit;
  const baseUrl = process.env.APP_BASE_URL ?? new URL(reqUrl).origin;
  return `${baseUrl}/api/auth/oauth/google/callback`;
}

/**
 * Whether Google sign-in is fully configured.
 *
 * Returns a reason rather than a bare boolean so the start route can log which
 * half is missing. A half-configured set (id present, secret absent) otherwise
 * fails at the token-exchange step, well after the user has already been sent
 * to Google and back, where the error surfaces as a generic failure.
 */
export function googleOauthConfigStatus():
  | { ok: true }
  | { ok: false; reason: string } {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!id && !secret) {
    return { ok: false, reason: "GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET are both unset" };
  }
  if (!id) return { ok: false, reason: "GOOGLE_OAUTH_CLIENT_SECRET is set but GOOGLE_OAUTH_CLIENT_ID is missing" };
  if (!secret) return { ok: false, reason: "GOOGLE_OAUTH_CLIENT_ID is set but GOOGLE_OAUTH_CLIENT_SECRET is missing" };
  return { ok: true };
}
