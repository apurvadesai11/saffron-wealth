import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NetWorthChart, {
  getCutoffDate,
  filterSeriesByRange,
  computeYDomain,
  seriesCrossesZero,
  buildPathD,
  nearestIndexForTime,
} from "./NetWorthChart";
import type { NetWorthPoint } from "@/lib/net-worth-history";

// Round synthetic numbers only — see CLAUDE.md: real balances must never
// appear in source, tests, or commits. This fixture deliberately starts
// deeply negative and crosses zero, mirroring the real user's mortgage-heavy
// early years, without using any real personal figures.
function makeSeries(): NetWorthPoint[] {
  return [
    { date: "2020-01-01", value: -800000 },
    { date: "2020-07-01", value: -700000 },
    { date: "2021-01-01", value: -500000 },
    { date: "2022-01-01", value: -200000 },
    { date: "2023-01-01", value: -50000 },
    { date: "2024-01-01", value: 100000 },
    { date: "2025-01-01", value: 300000 },
    { date: "2026-01-01", value: 500000 },
    { date: "2026-06-01", value: 550000 },
  ];
}

// The fixture's last date is deliberately far from the real wall-clock date
// this test suite runs on. If range cutoffs were ever computed from
// Date.now() instead of the series' own last point, these counts would not
// match — that's the regression this fixture is designed to catch.
const LAST_DATE = "2026-06-01";

describe("getCutoffDate", () => {
  it("computes cutoffs relative to the series' last date, not the wall clock", () => {
    expect(getCutoffDate("3M", LAST_DATE)).toBe("2026-03-01");
    expect(getCutoffDate("6M", LAST_DATE)).toBe("2025-12-01");
    expect(getCutoffDate("1Y", LAST_DATE)).toBe("2025-06-01");
    expect(getCutoffDate("YTD", LAST_DATE)).toBe("2026-01-01");
    expect(getCutoffDate("3Y", LAST_DATE)).toBe("2023-06-01");
    expect(getCutoffDate("5Y", LAST_DATE)).toBe("2021-06-01");
    expect(getCutoffDate("10Y", LAST_DATE)).toBe("2016-06-01");
  });

  it("returns null for MAX — no lower bound", () => {
    expect(getCutoffDate("MAX", LAST_DATE)).toBeNull();
  });

  // Regression coverage: naive `Date.setMonth`/`setFullYear` arithmetic keeps
  // the original day-of-month and lets JS overflow into the *next* month
  // when the target month is shorter (e.g. Feb 31 normalizes to Mar 3). A
  // real net-worth series' last date is normally "today," so this class of
  // bug silently misfires on roughly a third of all possible last dates —
  // it just never showed up before because every other fixture in this file
  // happens to use a day-of-month that exists in every month.
  it("clamps into the target month's last day for 3M/6M off a 31st, instead of overflowing into March", () => {
    expect(getCutoffDate("3M", "2026-05-31")).toBe("2026-02-28");
    expect(getCutoffDate("6M", "2026-08-31")).toBe("2026-02-28");
  });

  it("clamps a Feb 29 last date to Feb 28 of the target non-leap year for 1Y/3Y/5Y/10Y", () => {
    expect(getCutoffDate("1Y", "2024-02-29")).toBe("2023-02-28");
    expect(getCutoffDate("3Y", "2024-02-29")).toBe("2021-02-28");
    expect(getCutoffDate("5Y", "2024-02-29")).toBe("2019-02-28");
    expect(getCutoffDate("10Y", "2024-02-29")).toBe("2014-02-28");
  });
});

describe("filterSeriesByRange", () => {
  it("keeps only points on/after the last-date-relative cutoff", () => {
    const series = makeSeries();
    // Cutoff for YTD is 2026-01-01 — the 2026-01-01 and 2026-06-01 points qualify.
    expect(filterSeriesByRange(series, "YTD")).toEqual([
      { date: "2026-01-01", value: 500000 },
      { date: "2026-06-01", value: 550000 },
    ]);
  });

  it("MAX returns every point unfiltered", () => {
    const series = makeSeries();
    expect(filterSeriesByRange(series, "MAX")).toEqual(series);
  });

  it("returns an empty array for an empty series without throwing", () => {
    expect(filterSeriesByRange([], "1Y")).toEqual([]);
  });

  it("always includes at least the series' own last point (regression guard against a Date.now()-based cutoff)", () => {
    const series = makeSeries();
    for (const range of ["3M", "6M", "YTD", "1Y", "3Y", "5Y", "10Y", "MAX"] as const) {
      const filtered = filterSeriesByRange(series, range);
      expect(filtered.length).toBeGreaterThan(0);
      expect(filtered[filtered.length - 1]).toEqual(series[series.length - 1]);
    }
  });
});

describe("computeYDomain", () => {
  it("includes 0 within the domain when the series crosses it", () => {
    const [min, max] = computeYDomain([-800000, -50000, 100000, 550000]);
    expect(min).toBeLessThan(0);
    expect(max).toBeGreaterThan(0);
  });

  it("does not force 0 into the domain when the series never crosses it", () => {
    // A wrong implementation that always clamps the domain floor to 0 (a
    // bar-chart convention) would fail this — the whole point of a
    // padded-extent domain is to show the real variation, not squash it
    // against a forced zero baseline.
    const [min] = computeYDomain([500000, 600000, 550000]);
    expect(min).toBeGreaterThan(0);
  });

  it("pads a flat (single-value) series instead of collapsing to a zero-span domain", () => {
    const [min, max] = computeYDomain([100000]);
    expect(min).toBeLessThan(100000);
    expect(max).toBeGreaterThan(100000);
  });

  it("pads a flat series at exactly zero without producing NaN", () => {
    const [min, max] = computeYDomain([0]);
    expect(Number.isNaN(min)).toBe(false);
    expect(Number.isNaN(max)).toBe(false);
    expect(min).toBeLessThan(0);
    expect(max).toBeGreaterThan(0);
  });

  // The component's series.length === 0 branch returns before rendering
  // anything that reads `domain`, but its useMemo chain still runs above
  // that return (hooks can't be conditional) with filtered = [] — so this
  // guards the specific empty-array call the component actually makes.
  // Without the explicit length check, Math.min(...[])/Math.max(...[])
  // (±Infinity) would turn into NaN through the padding subtraction/addition.
  it("returns a degenerate but non-NaN domain for an empty values array", () => {
    const [min, max] = computeYDomain([]);
    expect(Number.isNaN(min)).toBe(false);
    expect(Number.isNaN(max)).toBe(false);
  });
});

describe("seriesCrossesZero", () => {
  it("is true when the raw data spans negative to positive", () => {
    expect(seriesCrossesZero([-800000, -50000, 100000, 550000])).toBe(true);
  });

  it("is false for an all-positive series even when its minimum is small relative to its span", () => {
    // Regression case: computeYDomain's 8% pad on a $1,000-$100,000 series
    // pushes the padded floor to -$6,920 — below zero even though every
    // real data point is positive. crossesZero must not be derived from
    // that padded domain, or this would incorrectly report a crossing.
    const values = [1000, 50000, 100000];
    const [paddedMin] = computeYDomain(values);
    expect(paddedMin).toBeLessThan(0); // confirms the padding does dip below zero here
    expect(seriesCrossesZero(values)).toBe(false);
  });

  it("is false for an all-negative series", () => {
    expect(seriesCrossesZero([-900000, -850000, -700000])).toBe(false);
  });

  it("is false for an empty array", () => {
    expect(seriesCrossesZero([])).toBe(false);
  });
});

describe("buildPathD", () => {
  it("emits exactly one path command per point", () => {
    const coords = [
      { x: 0, y: 10 },
      { x: 5, y: 20 },
      { x: 10, y: 5 },
      { x: 15, y: 30 },
    ];
    const d = buildPathD(coords);
    expect(d.split(" ")).toHaveLength(coords.length);
  });

  it("starts with M and follows with L commands", () => {
    const d = buildPathD([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
    const commands = d.split(" ");
    expect(commands[0].startsWith("M")).toBe(true);
    expect(commands.slice(1).every((c) => c.startsWith("L"))).toBe(true);
  });

  it("returns an empty string for zero or one point — no broken path", () => {
    expect(buildPathD([])).toBe("");
    expect(buildPathD([{ x: 0, y: 0 }])).toBe("");
  });
});

describe("nearestIndexForTime", () => {
  const times = [0, 10, 20, 30, 40];

  it("returns the closest index for an interior target", () => {
    expect(nearestIndexForTime(times, 4)).toBe(0);
    expect(nearestIndexForTime(times, 6)).toBe(1);
    expect(nearestIndexForTime(times, 25)).toBe(2); // tie rounds to the earlier index
  });

  it("clamps to the first/last index for out-of-range targets", () => {
    expect(nearestIndexForTime(times, -100)).toBe(0);
    expect(nearestIndexForTime(times, 1000)).toBe(4);
  });

  it("returns -1 for an empty times array", () => {
    expect(nearestIndexForTime([], 5)).toBe(-1);
  });
});

describe("<NetWorthChart /> — empty and single-point series", () => {
  it("renders an explicit empty state for an empty series, not a broken chart", () => {
    const { container } = render(<NetWorthChart series={[]} />);
    expect(screen.getByText("No net worth history yet.")).toBeInTheDocument();
    const root = container.querySelector('[data-state="empty"]');
    expect(root).toHaveAttribute("data-point-count", "0");
  });

  it("does not throw for a single-point series", () => {
    expect(() =>
      render(<NetWorthChart series={[{ date: "2026-01-01", value: 100000 }]} />),
    ).not.toThrow();
  });

  it("a single-point series has no <path> line (nothing to connect) but still reports its point count", () => {
    const { container } = render(<NetWorthChart series={[{ date: "2026-01-01", value: 100000 }]} />);
    expect(container.querySelector("path")).not.toBeInTheDocument();
    expect(container.querySelector('[data-point-count="1"]')).toBeInTheDocument();
  });
});

describe("<NetWorthChart /> — range toggles", () => {
  it("defaults to MAX and reports the full point count", () => {
    const series = makeSeries();
    const { container } = render(<NetWorthChart series={series} />);
    expect(container.querySelector('[data-point-count]')).toHaveAttribute(
      "data-point-count",
      String(series.length),
    );
    expect(screen.getByRole("button", { name: "MAX" })).toHaveAttribute("data-range", "MAX");
  });

  it("only the active toggle carries data-range", () => {
    const series = makeSeries();
    render(<NetWorthChart series={series} />);
    for (const label of ["3M", "6M", "YTD", "1Y", "3Y", "5Y", "10Y"]) {
      expect(screen.getByRole("button", { name: label })).not.toHaveAttribute("data-range");
    }
  });

  it("switching to YTD updates data-point-count to match filterSeriesByRange", async () => {
    const series = makeSeries();
    const { container } = render(<NetWorthChart series={series} />);
    const expected = filterSeriesByRange(series, "YTD").length;

    await userEvent.click(screen.getByRole("button", { name: "YTD" }));

    expect(screen.getByRole("button", { name: "YTD" })).toHaveAttribute("data-range", "YTD");
    expect(container.querySelector('[data-point-count]')).toHaveAttribute(
      "data-point-count",
      String(expected),
    );
    // Guards against a Date.now()-based cutoff: with this fixture's last
    // date fixed at 2026-06-01, YTD must resolve to exactly the two 2026
    // points below, not whatever the real current year happens to be.
    expect(expected).toBe(2);
  });

  it("each range toggle produces the point count filterSeriesByRange predicts for it", async () => {
    const series = makeSeries();
    const { container } = render(<NetWorthChart series={series} />);

    for (const range of ["3M", "6M", "1Y", "3Y", "5Y", "10Y", "MAX"] as const) {
      const expected = filterSeriesByRange(series, range).length;
      await userEvent.click(screen.getByRole("button", { name: range }));
      expect(container.querySelector('[data-point-count]')).toHaveAttribute(
        "data-point-count",
        String(expected),
      );
    }
  });

  it("the rendered path's d attribute has one command per filtered point, and tracks range changes", async () => {
    const series = makeSeries();
    const { container } = render(<NetWorthChart series={series} />);

    const dAtMax = container.querySelector("path")!.getAttribute("d")!;
    expect(dAtMax.split(" ")).toHaveLength(series.length);

    await userEvent.click(screen.getByRole("button", { name: "YTD" }));
    const dAtYtd = container.querySelector("path")!.getAttribute("d")!;
    expect(dAtYtd.split(" ")).toHaveLength(filterSeriesByRange(series, "YTD").length);
  });
});

describe("<NetWorthChart /> — negative values and the zero crossing", () => {
  it("marks data-crosses-zero true for a series that goes negative to positive", () => {
    const { container } = render(<NetWorthChart series={makeSeries()} />);
    expect(container.querySelector('[data-crosses-zero]')).toHaveAttribute("data-crosses-zero", "true");
  });

  it("renders a visible zero reference line when the series crosses zero", () => {
    const { container } = render(<NetWorthChart series={makeSeries()} />);
    // The dashed zero line is the only <line> element present before any
    // hover interaction (the hover guide line only renders on pointer move).
    expect(container.querySelectorAll("svg line")).toHaveLength(1);
  });

  it("does not mark data-crosses-zero for an all-positive series, and renders no zero line", () => {
    const allPositive: NetWorthPoint[] = [
      { date: "2025-01-01", value: 500000 },
      { date: "2025-06-01", value: 550000 },
      { date: "2026-01-01", value: 600000 },
    ];
    const { container } = render(<NetWorthChart series={allPositive} />);
    expect(container.querySelector('[data-crosses-zero]')).toHaveAttribute("data-crosses-zero", "false");
    expect(container.querySelectorAll("svg line")).toHaveLength(0);
  });

  it("does not throw on an all-negative series and still renders the path", () => {
    const allNegative: NetWorthPoint[] = [
      { date: "2020-01-01", value: -900000 },
      { date: "2020-06-01", value: -850000 },
      { date: "2021-01-01", value: -700000 },
    ];
    const { container } = render(<NetWorthChart series={allNegative} />);
    expect(container.querySelector('[data-crosses-zero]')).toHaveAttribute("data-crosses-zero", "false");
    expect(container.querySelector("path")).toBeInTheDocument();
  });

  it("does not mark data-crosses-zero for an all-positive series whose minimum is small relative to its span", () => {
    // Regression case for deriving crossesZero from the padded domain
    // instead of the raw data: this series' min (1000) is small enough that
    // computeYDomain's 8% pad dips its floor below zero, but every actual
    // point is still positive — the chart must not draw a zero line here.
    const nearZeroButPositive: NetWorthPoint[] = [
      { date: "2025-01-01", value: 1000 },
      { date: "2025-06-01", value: 50000 },
      { date: "2026-01-01", value: 100000 },
    ];
    const { container } = render(<NetWorthChart series={nearZeroButPositive} />);
    expect(container.querySelector('[data-crosses-zero]')).toHaveAttribute("data-crosses-zero", "false");
    expect(container.querySelectorAll("svg line")).toHaveLength(0);
  });
});

describe("<NetWorthChart /> — hover interaction doesn't crash without real layout", () => {
  it("survives a mousemove/mouseleave over the overlay rect in happy-dom", () => {
    const { container } = render(<NetWorthChart series={makeSeries()} />);
    const overlay = container.querySelector("rect")!;
    expect(() => {
      fireEvent.mouseMove(overlay, { clientX: 100, clientY: 50 });
      fireEvent.mouseLeave(overlay);
    }).not.toThrow();
  });
});

// role="img" prunes an element's descendants from the accessibility tree,
// which would have made the axis min/max/date labels — the only non-hover
// way to read a number off this chart — invisible to screen readers while
// still visible to sighted users. These tests cover the fix: a static
// sr-only summary living outside the SVG, and a keyboard-operable slider
// that drives the same hoverIndex state (and therefore the same tooltip)
// the mouse does.
describe("<NetWorthChart /> — accessible without hovering or a mouse", () => {
  it("exposes a static summary of the chart's values outside the SVG, independent of any hover", () => {
    const series = makeSeries();
    render(<NetWorthChart series={series} />);
    // Covers the same ground as the visible axis labels: range, point count,
    // and the first/last point's formatted date + value.
    const summary = screen.getByText(/^Net worth chart, MAX range, 9 data points\./);
    expect(summary).toHaveTextContent("2020"); // first point's year
    expect(summary).toHaveTextContent("2026"); // last point's year
  });

  it("the slider control defaults its value to the most recent point before any interaction", () => {
    const series = makeSeries();
    render(<NetWorthChart series={series} />);
    const slider = screen.getByRole("slider", { name: "Net worth value explorer" });
    expect(slider).toHaveAttribute("aria-valuenow", String(series.length - 1));
    expect(slider).toHaveAttribute("aria-valuemin", "0");
    expect(slider).toHaveAttribute("aria-valuemax", String(series.length - 1));
  });

  it("ArrowLeft/ArrowRight step the focused index without a mouse", () => {
    const series = makeSeries();
    render(<NetWorthChart series={series} />);
    const slider = screen.getByRole("slider", { name: "Net worth value explorer" });

    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(slider).toHaveAttribute("aria-valuenow", String(series.length - 2));

    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider).toHaveAttribute("aria-valuenow", String(series.length - 1));
  });

  it("ArrowRight does not step past the last index", () => {
    const series = makeSeries();
    render(<NetWorthChart series={series} />);
    const slider = screen.getByRole("slider", { name: "Net worth value explorer" });

    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider).toHaveAttribute("aria-valuenow", String(series.length - 1));
  });

  it("Home/End jump to the first/last visible point", () => {
    const series = makeSeries();
    render(<NetWorthChart series={series} />);
    const slider = screen.getByRole("slider", { name: "Net worth value explorer" });

    fireEvent.keyDown(slider, { key: "Home" });
    expect(slider).toHaveAttribute("aria-valuenow", "0");

    fireEvent.keyDown(slider, { key: "End" });
    expect(slider).toHaveAttribute("aria-valuenow", String(series.length - 1));
  });

  it("Home/End re-filter correctly after a range change, matching the narrower point set", async () => {
    const series = makeSeries();
    render(<NetWorthChart series={series} />);
    await userEvent.click(screen.getByRole("button", { name: "YTD" }));

    const ytdCount = filterSeriesByRange(series, "YTD").length;
    const slider = screen.getByRole("slider", { name: "Net worth value explorer" });

    fireEvent.keyDown(slider, { key: "End" });
    expect(slider).toHaveAttribute("aria-valuenow", String(ytdCount - 1));
  });

  it("updates aria-valuetext to the focused point's formatted date and value", () => {
    const series = makeSeries();
    render(<NetWorthChart series={series} />);
    const slider = screen.getByRole("slider", { name: "Net worth value explorer" });

    fireEvent.keyDown(slider, { key: "Home" });
    expect(slider).toHaveAttribute("aria-valuetext", expect.stringContaining("2020"));
    expect(slider).toHaveAttribute("aria-valuetext", expect.stringContaining("$800,000"));
  });

  it("the live region is silent until the control is actually moved, then announces the focused point", () => {
    const series = makeSeries();
    const { container } = render(<NetWorthChart series={series} />);
    const liveRegion = container.querySelector('[aria-live="polite"]')!;
    expect(liveRegion).toHaveTextContent("");

    const slider = screen.getByRole("slider", { name: "Net worth value explorer" });
    fireEvent.keyDown(slider, { key: "Home" });
    expect(liveRegion.textContent).not.toBe("");
    expect(liveRegion.textContent).toContain("2020");
  });

  it("focusing the slider (Tab) activates the live announcement, same as a native range input revealing its value", () => {
    // aria-valuenow already defaults to the last index before any
    // interaction (see the "defaults its value" test above), so this test
    // asserts the part that actually changes on focus: the live region,
    // silent until now, starts speaking.
    const series = makeSeries();
    const { container } = render(<NetWorthChart series={series} />);
    const liveRegion = container.querySelector('[aria-live="polite"]')!;
    const slider = screen.getByRole("slider", { name: "Net worth value explorer" });

    expect(liveRegion).toHaveTextContent("");
    fireEvent.focus(slider);
    expect(liveRegion.textContent).not.toBe("");
  });

  it("does not throw when stepping a single-point series by keyboard", () => {
    const single: NetWorthPoint[] = [{ date: "2026-01-01", value: 100000 }];
    render(<NetWorthChart series={single} />);
    const slider = screen.getByRole("slider", { name: "Net worth value explorer" });
    expect(() => {
      fireEvent.keyDown(slider, { key: "ArrowRight" });
      fireEvent.keyDown(slider, { key: "ArrowLeft" });
      fireEvent.keyDown(slider, { key: "Home" });
      fireEvent.keyDown(slider, { key: "End" });
    }).not.toThrow();
    expect(slider).toHaveAttribute("aria-valuemax", "0");
  });
});
