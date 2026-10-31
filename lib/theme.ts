// The theme preference: a display setting, stored per browser in a plain
// cookie so the server can render <html data-theme> before first paint (no
// flash of the wrong theme, no inline script). It is deliberately not on
// `User` and not behind CSRF: it carries no authority and changes nothing on
// the server. See docs/decisions/0012-theme-tokens-and-cookie-preference.md.

export const THEME_COOKIE = "sw_theme";

export type ThemePreference = "light" | "dark" | "system";

export const THEME_PREFERENCES: ThemePreference[] = ["light", "system", "dark"];

/** Anything unrecognised, including no cookie at all, means follow the OS. */
export function parseThemePreference(value: string | null | undefined): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

/**
 * The `data-theme` attribute for a preference. System has none, so the
 * `prefers-color-scheme` media query in the generated CSS decides.
 */
export function themeAttribute(pref: ThemePreference): "light" | "dark" | undefined {
  return pref === "system" ? undefined : pref;
}

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function serializeThemeCookie(pref: ThemePreference, secure: boolean): string {
  // System is stored explicitly rather than by deleting the cookie, so a
  // deliberate choice survives and reads the same as no choice.
  return `${THEME_COOKIE}=${pref}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function readThemeCookie(cookieHeader: string): ThemePreference {
  const match = cookieHeader.match(new RegExp(`(?:^|; )${THEME_COOKIE}=([^;]+)`));
  return parseThemePreference(match?.[1]);
}
