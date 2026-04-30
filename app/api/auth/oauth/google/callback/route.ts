import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  exchangeGoogleCode,
  fetchGoogleProfile,
  googleCallbackRedirectUri,
} from "@/lib/auth/google-oauth";
import {
  OAUTH_STATE_COOKIE,
  validateOauthState,
} from "@/lib/auth/oauth-state";
import { normalizeEmail } from "@/lib/auth/validation";
import { createSession } from "@/lib/auth/sessions";
import { setSessionCookie } from "@/lib/auth/session-cookie";
import { recordAuthEvent } from "@/lib/auth/audit-log";
import { clientIp, userAgent } from "@/lib/auth/request-info";

function redirectErr(req: NextRequest, code: string) {
  return NextResponse.redirect(new URL(`/login?oauth=${code}`, req.url));
}

function clearStateCookie(res: NextResponse): void {
  res.cookies.set({ name: OAUTH_STATE_COOKIE, value: "", path: "/", maxAge: 0 });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) return redirectErr(req, "denied");
  if (!code || !stateParam) return redirectErr(req, "missing_code");

  const stateCookie = req.cookies.get(OAUTH_STATE_COOKIE)?.value;
  if (!validateOauthState(stateCookie, stateParam)) {
    return redirectErr(req, "invalid_state");
  }

  const redirectUri = googleCallbackRedirectUri(req.url);

  let tokens;
  try {
    tokens = await exchangeGoogleCode(code, redirectUri);
  } catch (err) {
     
    console.error("[oauth/google/callback] code exchange failed", err);
    return redirectErr(req, "token_exchange_failed");
  }
  if (!tokens.access_token) return redirectErr(req, "no_access_token");

  let profile;
  try {
    profile = await fetchGoogleProfile(tokens.access_token);
  } catch (err) {
     
    console.error("[oauth/google/callback] userinfo failed", err);
    return redirectErr(req, "userinfo_failed");
  }

  // Account-linking gate: refuse to associate an unverified Google email
  // with an existing user. Otherwise an attacker could create a Google
  // account using the victim's email at a permissive provider (gmail
  // verifies, but this guards against future provider additions and IdP
  // misbehavior).
  if (!profile.email_verified) {
    return redirectErr(req, "email_unverified");
  }

  const emailNormalized = normalizeEmail(profile.email);
  const ip = clientIp(req);
  const ua = userAgent(req);

  // Find existing user either by linked Google account OR by email.
  // Linked-account match wins; email match second.
  const linked = await prisma.user.findFirst({
    where: {
      oauthAccounts: {
        some: { provider: "google", providerAccountId: profile.sub },
      },
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      profilePicture: true,
    },
  });

  let userId: string;
  let isNewUser = false;
  let didLinkExisting = false;

  if (linked) {
    userId = linked.id;
    // Refresh stored OAuth tokens for this user/provider combo.
    await prisma.oAuthAccount.updateMany({
      where: { userId, provider: "google", providerAccountId: profile.sub },
      data: {
        accessToken: tokens.access_token,
        ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
        expiresAt: tokens.expires_in
          ? Math.floor(Date.now() / 1000) + tokens.expires_in
          : null,
      },
    });
  } else {
    // Try email match — if the email is already on an existing User, link
    // the new Google account to that user (rather than creating a duplicate
    // account for the same email).
    const byEmail = await prisma.user.findUnique({
      where: { emailNormalized },
      select: { id: true, profilePicture: true },
    });

    if (byEmail) {
      userId = byEmail.id;
      didLinkExisting = true;
      await prisma.oAuthAccount.create({
        data: {
          userId,
          provider: "google",
          providerAccountId: profile.sub,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token ?? null,
          expiresAt: tokens.expires_in
            ? Math.floor(Date.now() / 1000) + tokens.expires_in
            : null,
        },
      });
      // Adopt Google's profile picture for users who don't have one yet.
      if (!byEmail.profilePicture && profile.picture) {
        await prisma.user.update({
          where: { id: userId },
          data: { profilePicture: profile.picture },
        });
      }
    } else {
      // Brand-new user via Google.
      isNewUser = true;
      const created = await prisma.user.create({
        data: {
          email: profile.email,
          emailNormalized,
          firstName: profile.given_name ?? "",
          lastName: profile.family_name ?? "",
          profilePicture: profile.picture ?? null,
          oauthAccounts: {
            create: {
              provider: "google",
              providerAccountId: profile.sub,
              accessToken: tokens.access_token,
              refreshToken: tokens.refresh_token ?? null,
              expiresAt: tokens.expires_in
                ? Math.floor(Date.now() / 1000) + tokens.expires_in
                : null,
            },
          },
        },
        select: { id: true },
      });
      userId = created.id;
    }
  }

  const session = await createSession(userId, ua, ip);

  await Promise.all([
    isNewUser
      ? recordAuthEvent({
          type: "signup",
          userId,
          ipAddress: ip,
          userAgent: ua,
          metadata: { provider: "google" },
        })
      : Promise.resolve(),
    recordAuthEvent({
      type: "google_oauth_signin",
      userId,
      ipAddress: ip,
      userAgent: ua,
      metadata: { isNewUser, didLinkExisting, emailNormalized },
    }),
    recordAuthEvent({
      type: "login_success",
      userId,
      ipAddress: ip,
      userAgent: ua,
      metadata: { provider: "google", emailNormalized },
    }),
  ]);

  const res = NextResponse.redirect(new URL("/", req.url));
  clearStateCookie(res);
  setSessionCookie(res, session.rawToken, session.expiresAt);
  return res;
}
