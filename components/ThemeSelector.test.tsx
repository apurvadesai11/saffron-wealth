import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ThemeSelector from "./ThemeSelector";
import { THEME_COOKIE } from "@/lib/theme";

function clearThemeCookie() {
  document.cookie = `${THEME_COOKIE}=; Path=/; Max-Age=0`;
}

describe("ThemeSelector", () => {
  beforeEach(() => {
    clearThemeCookie();
    delete document.documentElement.dataset.theme;
  });
  afterEach(clearThemeCookie);

  it("shows System as selected when no preference is stored", () => {
    render(<ThemeSelector />);
    expect(screen.getByRole("radio", { name: "System" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "false");
  });

  it("reflects a stored preference", () => {
    document.cookie = `${THEME_COOKIE}=dark; Path=/`;
    render(<ThemeSelector />);
    expect(screen.getByRole("radio", { name: "Dark" })).toHaveAttribute("data-state", "selected");
  });

  it("choosing Dark sets the attribute, writes the cookie, and moves the selection", async () => {
    render(<ThemeSelector />);
    await userEvent.click(screen.getByRole("radio", { name: "Dark" }));

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.cookie).toContain(`${THEME_COOKIE}=dark`);
    expect(screen.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "System" })).toHaveAttribute("aria-checked", "false");
  });

  it("choosing Light sets the attribute, so it overrides a dark OS", async () => {
    render(<ThemeSelector />);
    await userEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.cookie).toContain(`${THEME_COOKIE}=light`);
  });

  it("choosing System removes the attribute so the media query decides", async () => {
    document.documentElement.dataset.theme = "dark";
    document.cookie = `${THEME_COOKIE}=dark; Path=/`;
    render(<ThemeSelector />);
    await userEvent.click(screen.getByRole("radio", { name: "System" }));

    expect(document.documentElement).not.toHaveAttribute("data-theme");
    expect(document.cookie).toContain(`${THEME_COOKIE}=system`);
  });
});
