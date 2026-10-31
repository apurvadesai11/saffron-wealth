import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithApp } from "./__tests__/test-utils";
import Sidebar from "./Sidebar";

vi.mock("next/navigation", () => ({
  usePathname: () => "/net-worth",
}));

// The nav's children in DOM order, with each separator shown as "---", so one
// assertion pins both the item order and where the divider falls.
function navOutline(): string[] {
  const nav = screen.getByRole("navigation");
  return Array.from(nav.children).map(el =>
    el.getAttribute("role") === "separator" ? "---" : (el.textContent ?? "").trim(),
  );
}

describe("Sidebar", () => {
  it("lists Net Worth first and divides the money pages from the settings pages", () => {
    renderWithApp(<Sidebar />);
    expect(navOutline()).toEqual([
      "Net Worth",
      "Monthly Review",
      "Transactions",
      "---",
      "Financial Profile",
      "Profile",
    ]);
  });

  it("links Monthly Review to its own route, now that / lands on Net Worth", () => {
    renderWithApp(<Sidebar />);
    const nav = screen.getByRole("navigation");
    expect(within(nav).getByRole("link", { name: /Monthly Review/ })).toHaveAttribute(
      "href",
      "/monthly-review",
    );
    expect(within(nav).getByRole("link", { name: /Net Worth/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
