import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import NetWorthSummaryCards from "./NetWorthSummaryCards";

describe("NetWorthSummaryCards", () => {
  it("renders assets, liabilities, and a positive net worth in green", () => {
    render(
      <NetWorthSummaryCards
        summary={{ totalAssets: 10000, totalLiabilities: 2000, netWorth: 8000 }}
      />,
    );
    expect(screen.getByText("$10000.00")).toBeInTheDocument();
    expect(screen.getByText("$2000.00")).toBeInTheDocument();
    const netWorth = screen.getByText("$8000.00");
    expect(netWorth).toBeInTheDocument();
    expect(netWorth.className).toMatch(/text-green-600/);
  });

  it("shows a negative net worth in red with data-net-worth-sign=negative", () => {
    const { container } = render(
      <NetWorthSummaryCards
        summary={{ totalAssets: 1000, totalLiabilities: 5000, netWorth: -4000 }}
      />,
    );
    const netWorth = screen.getByText("$-4000.00");
    expect(netWorth.className).toMatch(/text-red-600/);
    expect(container.querySelector('[data-net-worth-sign="negative"]')).toBeInTheDocument();
  });

  it("marks a zero net worth as positive", () => {
    const { container } = render(
      <NetWorthSummaryCards summary={{ totalAssets: 0, totalLiabilities: 0, netWorth: 0 }} />,
    );
    expect(container.querySelector('[data-net-worth-sign="positive"]')).toBeInTheDocument();
  });
});
