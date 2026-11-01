import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import FireChart, { bandPath, niceTicks, yDomain } from "./FireChart";
import type { FireSummary } from "@/lib/fire-simulation";

// Synthetic round numbers only (CLAUDE.md: real balances never appear in
// source, tests or commits).
type Bands = FireSummary["bands"];

// Three years, widening spread: the shape a real projection has.
function makeBands(): Bands {
  return [
    { year: 0, p10: 100_000, p50: 100_000, p90: 100_000 },
    { year: 1, p10: 120_000, p50: 150_000, p90: 180_000 },
    { year: 2, p10: 140_000, p50: 200_000, p90: 280_000 },
  ];
}

// A longer path to exercise ticks and the aria-label: 30 years, linear.
function makeLongBands(): Bands {
  return Array.from({ length: 31 }, (_, year) => ({
    year,
    p10: 100_000 + year * 10_000,
    p50: 100_000 + year * 20_000,
    p90: 100_000 + year * 30_000,
  }));
}

describe("yDomain", () => {
  it("covers the band and the FI line", () => {
    // FI sits above every p90, so a domain taken from the band alone would
    // clip the line off the top of the plot.
    const [, max] = yDomain(makeBands(), 1_000_000, null);
    expect(max).toBeGreaterThanOrEqual(1_000_000);
  });

  it("covers the coast curve when there is one", () => {
    const [, max] = yDomain(makeBands(), 500_000, [100_000, 900_000]);
    expect(max).toBeGreaterThanOrEqual(900_000);
  });

  it("ignores a gap in the coast curve instead of reading it as zero", () => {
    // coastFiNumber is null at the target age; a null must not drag the floor
    // or the ceiling anywhere.
    const withGap = [100_000, null, 300_000] as unknown as number[];
    expect(yDomain(makeBands(), 500_000, withGap)).toEqual(yDomain(makeBands(), 500_000, [100_000, 300_000]));
  });

  it("anchors at zero when every value is positive", () => {
    // Unlike net worth, this chart answers "how far from the target", and a
    // floor above zero would exaggerate the progress.
    const [min] = yDomain(makeBands(), 1_000_000, null);
    expect(min).toBe(0);
  });

  it("reaches below zero when the band does", () => {
    const sinking: Bands = [
      { year: 0, p10: 50_000, p50: 50_000, p90: 50_000 },
      { year: 1, p10: -30_000, p50: 20_000, p90: 90_000 },
    ];
    const [min] = yDomain(sinking, 1_000_000, null);
    expect(min).toBeLessThan(-30_000);
  });

  it("does not collapse when everything is zero", () => {
    const flat: Bands = [
      { year: 0, p10: 0, p50: 0, p90: 0 },
      { year: 1, p10: 0, p50: 0, p90: 0 },
    ];
    const [min, max] = yDomain(flat, 0, null);
    expect(max).toBeGreaterThan(min);
  });
});

describe("bandPath", () => {
  it("closes the area", () => {
    const d = bandPath(
      makeBands(),
      (year) => year * 10,
      (value) => 1000 - value / 1000,
    );
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
  });

  it("runs out along p90 and back along p10", () => {
    const bands: Bands = [
      { year: 0, p10: 1, p50: 2, p90: 3 },
      { year: 1, p10: 4, p50: 5, p90: 6 },
    ];
    const d = bandPath(
      bands,
      (year) => year * 10,
      (value) => 100 - value,
    );
    expect(d).toBe("M0.00,97.00 L10.00,94.00 L10.00,96.00 L0.00,99.00 Z");
  });

  it("is empty when there is no area to draw", () => {
    const one: Bands = [{ year: 0, p10: 1, p50: 2, p90: 3 }];
    expect(bandPath([], () => 0, () => 0)).toBe("");
    expect(bandPath(one, () => 0, () => 0)).toBe("");
  });
});

describe("niceTicks", () => {
  it("lands on round numbers inside the range", () => {
    expect(niceTicks([0, 1_080_000], 4)).toEqual([0, 500_000, 1_000_000]);
    expect(niceTicks([35, 65], 6)).toEqual([35, 40, 45, 50, 55, 60, 65]);
  });

  it("starts at the first multiple at or above the minimum", () => {
    expect(niceTicks([-30_000, 120_000], 4)).toEqual([0, 50_000, 100_000]);
  });

  it("falls back to the one value when the range has no width", () => {
    expect(niceTicks([5, 5], 4)).toEqual([5]);
  });
});

describe("<FireChart />", () => {
  // The FI number is above the widest p90 (1,000,000 at year 30), so its line
  // has the plot to itself.
  const props = { age: 35, fiNumber: 1_200_000, bands: makeLongBands() };

  it("draws the band, the median and the FI number", () => {
    const { container } = render(<FireChart {...props} coastLine={null} view="fi" />);
    expect(container.querySelector('[data-series="band"]')).toBeInTheDocument();
    expect(container.querySelector('[data-series="median"]')).toBeInTheDocument();
    expect(container.querySelector('[data-series="fi"]')).toBeInTheDocument();
    expect(screen.getByText("FI number")).toBeInTheDocument();
  });

  it("draws the coast line only in the coast view", () => {
    const coastLine = props.bands.map((b) => 300_000 + b.year * 20_000);

    const fi = render(<FireChart {...props} coastLine={coastLine} view="fi" />);
    expect(fi.container.querySelector('[data-series="coast"]')).not.toBeInTheDocument();
    fi.unmount();

    const coast = render(<FireChart {...props} coastLine={coastLine} view="coast" />);
    expect(coast.container.querySelector('[data-series="coast"]')).toBeInTheDocument();
  });

  it("draws no coast line in the coast view when there is none", () => {
    const { container } = render(<FireChart {...props} coastLine={null} view="coast" />);
    expect(container.querySelector('[data-series="coast"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-series="median"]')).toBeInTheDocument();
  });

  it("gives the median one path command per year", () => {
    const { container } = render(<FireChart {...props} coastLine={null} view="fi" />);
    const d = container.querySelector('[data-series="median"]')!.getAttribute("d")!;
    expect(d.split(" ")).toHaveLength(props.bands.length);
  });

  it("puts the FI line above a band that never reaches it", () => {
    const { container } = render(<FireChart {...props} coastLine={null} view="fi" />);
    const fiY = Number(container.querySelector('[data-series="fi"]')!.getAttribute("y1"));
    const bandYs = [...container.querySelector('[data-series="band"]')!.getAttribute("d")!.matchAll(/,(-?[\d.]+)/g)].map((m) =>
      Number(m[1]),
    );
    // SVG y grows downward, so "above" is a smaller number.
    expect(fiY).toBeLessThan(Math.min(...bandYs));
  });

  it("labels the x axis in age, not years from now", () => {
    render(<FireChart {...props} coastLine={null} view="fi" />);
    // 35 + 30 years: ticks at every fifth age from 35 to 65.
    expect(screen.getByText("35")).toBeInTheDocument();
    expect(screen.getByText("65")).toBeInTheDocument();
    expect(screen.queryByText("30")).not.toBeInTheDocument();
  });

  it("summarises the neutral path for a screen reader", () => {
    render(<FireChart {...props} coastLine={null} view="fi" />);
    // Median at year 30 is 100,000 + 30 * 20,000, reached at age 35 + 30.
    const label = screen.getByRole("img").getAttribute("aria-label")!;
    expect(label).toContain("Median projection reaches $700,000 by age 65");
    expect(label).toContain("$1,200,000");
  });

  it("renders an empty state rather than a broken chart when there is nothing to plot", () => {
    const { container } = render(<FireChart {...props} bands={[]} coastLine={null} view="fi" />);
    expect(container.querySelector('[data-state="empty"]')).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeInTheDocument();
  });
});
