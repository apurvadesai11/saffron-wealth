import { randomBytes, timingSafeEqual } from "node:crypto";

// Short-lived cookie holding a random nonce. We put the same nonce into the
// OAuth `state` query param when redirecting to Google; on callback we compare
// the returned `state` to the cookie. Without this, an attacker could trick a
// signed-in user into linking the attacker's Google account to the victim's
// session.

export const OAUTH_STATE_COOKIE = "sw_oauth_state";
const STATE_TTL_SECONDS = 600;

export function generateOauthState(): string {
  return randomBytes(32).toString("base64url");
}

export function validateOauthState(
  cookieValue: string | undefined,
  paramValue: string | null,
): boolean {
  if (!cookieValue || !paramValue) return false;
  if (cookieValue.length !== paramValue.length) return false;
  try {
    return timingSafeEqual(
      Buffer.from(cookieValue, "utf8"),
      Buffer.from(paramValue, "utf8"),
    );
  } catch {
    return false;
  }
}

export const OAUTH_STATE_TTL_SECONDS = STATE_TTL_SECONDS;
