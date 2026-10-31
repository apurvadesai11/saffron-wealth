import { describe, expect, it } from "vitest";
import {
  THEME_COOKIE,
  parseThemePreference,
  readThemeCookie,
  serializeThemeCookie,
  themeAttribute,
} from "./theme";

describe("parseThemePreference", () => {
  it("accepts the two explicit themes", () => {
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("dark")).toBe("dark");
  });

  it("treats system, missing, and unknown values as system", () => {
    expect(parseThemePreference("system")).toBe("system");
    expect(parseThemePreference(undefined)).toBe("system");
    expect(parseThemePreference(null)).toBe("system");
    expect(parseThemePreference("")).toBe("system");
    expect(parseThemePreference("DARK")).toBe("system");
    expect(parseThemePreference("solarized")).toBe("system");
  });
});

describe("themeAttribute", () => {
  it("sets data-theme only for an explicit choice", () => {
    expect(themeAttribute("light")).toBe("light");
    expect(themeAttribute("dark")).toBe("dark");
    expect(themeAttribute("system")).toBeUndefined();
  });
});

describe("serializeThemeCookie", () => {
  it("writes a site-wide, year-long, Lax cookie", () => {
    const cookie = serializeThemeCookie("dark", false);
    expect(cookie).toMatch(new RegExp(`^${THEME_COOKIE}=dark;`));
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=31536000");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("Secure");
  });

  it("adds Secure over https", () => {
    expect(serializeThemeCookie("light", true)).toContain("; Secure");
  });

  it("stores system explicitly rather than clearing the cookie", () => {
    expect(serializeThemeCookie("system", false)).toMatch(new RegExp(`^${THEME_COOKIE}=system;`));
  });
});

describe("readThemeCookie", () => {
  it("finds the preference among other cookies", () => {
    expect(readThemeCookie(`sw_csrf=abc; ${THEME_COOKIE}=dark; other=1`)).toBe("dark");
    expect(readThemeCookie(`${THEME_COOKIE}=light`)).toBe("light");
  });

  it("does not match a cookie whose name merely ends in sw_theme", () => {
    expect(readThemeCookie(`x${THEME_COOKIE}=dark`)).toBe("system");
  });

  it("falls back to system", () => {
    expect(readThemeCookie("")).toBe("system");
    expect(readThemeCookie(`${THEME_COOKIE}=bogus`)).toBe("system");
  });
});
