import { NextResponse, type NextRequest } from "next/server";
import {
  buildGoogleAuthorizeUrl,
  googleCallbackRedirectUri,
} from "@/lib/auth/google-oauth";
import {
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_TTL_SECONDS,
  generateOauthState,
} from "@/lib/auth/oauth-state";

export async function GET(req: NextRequest) {
  const state = generateOauthState();
  const redirectUri = googleCallbackRedirectUri(req.url);

  let url: string;
  try {
    url = buildGoogleAuthorizeUrl(state, redirectUri);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[oauth/google/start] config missing", err);
    return NextResponse.redirect(new URL("/login?oauth=unconfigured", req.url));
  }

  const res = NextResponse.redirect(url);
  res.cookies.set({
    name: OAUTH_STATE_COOKIE,
    value: state,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // Lax (NOT Strict) — the user is returned to us via top-level navigation
    // from Google, and Strict would suppress the cookie on that nav.
    sameSite: "lax",
    path: "/",
    maxAge: OAUTH_STATE_TTL_SECONDS,
  });
  return res;
}
