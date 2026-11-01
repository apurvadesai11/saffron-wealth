import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import FireScenarioTable, { formatYears } from "./FireScenarioTable";
import type { ScenarioRow } from "@/lib/fire-simulation";

// Synthetic scenarios in the order summarize() returns them.
const ROWS: ScenarioRow[] = [
  { label: "Best", years: 6.5, startYear: 1982 },
  { label: "Optimistic", years: 10.1, startYear: 1995 },
  { label: "Neutral", years: 14.2027, startYear: 1966 },
  { label: "Pessimistic", years: 19, startYear: 1929 },
  { label: "Worst", years: null, startYear: 1973 },
];

function renderTable(overrides: Partial<React.ComponentProps<typeof FireScenarioTable>> = {}) {
  return render(
    <FireScenarioTable
      rows={ROWS}
      view="fi"
      age={35}
      asOf="2026-01-15"
      horizon={40}
      windowCount={87}
      firstStartYear={1871}
      lastStartYear={1957}
      share={0.634}
      {...overrides}
    />,
  );
}

// The body rows, each as its cell texts.
function bodyCells(): string[][] {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((tr) => within(tr).getAllByRole("cell").map((td) => td.textContent ?? ""));
}

describe("formatYears", () => {
  it("rounds to whole months", () => {
    expect(formatYears(14.2027, 40)).toBe("14 yrs 2 mo");
  });

  it("says Now for zero", () => {
    expect(formatYears(0, 40)).toBe("Now");
  });

  it("names the horizon when FI is never reached", () => {
    expect(formatYears(null, 40)).toBe("Not within 40 years");
  });

  it("carries a month that rounds up to a full year", () => {
    // 14.97 years is 179.6 months; rounding the remainder alone gives "14 yrs 12 mo".
    expect(formatYears(14.97, 40)).toBe("15 yrs 0 mo");
  });
});

describe("FireScenarioTable", () => {
  it("has the five columns", () => {
    renderTable();
    const headers = screen.getAllByRole("columnheader").map((th) => th.textContent);
    expect(headers).toEqual(["Scenario", "Years", "Age", "Year", "Like starting in"]);
  });

  it("renders five scenarios in order", () => {
    renderTable();
    expect(bodyCells().map((cells) => cells[0])).toEqual(["Best", "Optimistic", "Neutral", "Pessimistic", "Worst"]);
  });

  it("shows FI age and calendar year", () => {
    renderTable({ rows: [{ label: "Neutral", years: 14.2027, startYear: 1966 }] });
    const [scenario, years, age, year, startYear] = bodyCells()[0];
    expect(scenario).toBe("Neutral");
    expect(years).toBe("14 yrs 2 mo");
    // floor(35 + 14.2027): the age the target is crossed in. The year counts
    // the rounded 170 months on from January 2026, landing in March 2040.
    expect(age).toBe("49");
    expect(year).toBe("2040");
    expect(startYear).toBe("1966");
  });

  it("counts the year from today's month, so a late-year start rolls over", () => {
    // 5.8333 years is 70 months; from October 2026 that is August 2032. Adding
    // the years to 2026 alone would say 2031.
    renderTable({ asOf: "2026-10-31", rows: [{ label: "Neutral", years: 70 / 12, startYear: 1966 }] });
    const [, years, , year] = bodyCells()[0];
    expect(years).toBe("5 yrs 10 mo");
    expect(year).toBe("2032");
  });

  it("shows a dash for age and year when the scenario never gets there", () => {
    renderTable();
    const worst = bodyCells()[4];
    expect(worst[1]).toBe("Not within 40 years");
    expect(worst[2]).toBe("—");
    expect(worst[3]).toBe("—");
    expect(worst[4]).toBe("1973");
  });

  it("puts a scenario that is already there at today's age and year", () => {
    renderTable({ rows: [{ label: "Best", years: 0, startYear: 1982 }] });
    const [, years, age, year] = bodyCells()[0];
    expect(years).toBe("Now");
    expect(age).toBe("35");
    expect(year).toBe("2026");
  });

  it("describes the share of starts that reach FI by the target age", () => {
    renderTable({ view: "fi", share: 0.634 });
    expect(screen.getByText("63% of historical starts reach FI by your target age")).toBeInTheDocument();
  });

  it("describes the share of starts that are already Coast FI", () => {
    renderTable({ view: "coast", share: 0.25 });
    expect(screen.getByText("25% of historical starts are already Coast FI")).toBeInTheDocument();
    expect(screen.queryByText(/reach FI by your target age/)).not.toBeInTheDocument();
  });

  it("never calls the share a chance or a probability", () => {
    const { container } = renderTable();
    expect(container.textContent).not.toMatch(/chance|probab/i);
  });

  it("names the window set the scenarios come from", () => {
    renderTable();
    expect(screen.getByText("87 historical windows of 40 years, starting 1871–1957")).toBeInTheDocument();
  });
});
