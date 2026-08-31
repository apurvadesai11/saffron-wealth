"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { NetWorthPoint } from "@/lib/net-worth-history";

// ---------------------------------------------------------------------------
// Range toggles
// ---------------------------------------------------------------------------

const RANGE_KEYS = ["3M", "6M", "YTD", "1Y", "3Y", "5Y", "10Y", "MAX"] as const;
export type ChartRange = (typeof RANGE_KEYS)[number];

// MAX by default: this user's real series starts deeply negative (a large
// mortgage predating other assets) and crosses into positive territory —
// that arc is the whole point of shipping this chart, so don't default to a
// window that might hide it.
const DEFAULT_RANGE: ChartRange = "MAX";

// Used until (or unless) ResizeObserver reports a real size — most notably
// happy-dom in unit tests, which has no layout engine at all, but also the
// brief instant before a real browser's first callback fires.
const DEFAULT_WIDTH = 640;
const HEIGHT = 260;
const MARGIN = { top: 16, right: 16, bottom: 24, left: 64 };

// Headroom so the line doesn't touch the top/bottom edge of the plot area.
const DOMAIN_PADDING_RATIO = 0.08;

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const compactCurrencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const axisDateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" });
const tooltipDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

// ---------------------------------------------------------------------------
// Pure date/geometry helpers — exported for direct unit testing. happy-dom
// can't do SVG layout or pointer hit-testing, so the math is kept separable
// from rendering and is tested on its own in NetWorthChart.test.tsx.
// ---------------------------------------------------------------------------

// Same convention as lib/budget-utils.ts's parseLocalDate: new
// Date("YYYY-MM-DD") parses as UTC midnight and shifts the day in
// negative-offset timezones, so build the Date from local components.
function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Cutoffs are always relative to the series' own last date, never
// Date.now() — a chart keyed off the wall clock passes tests today and
// fails next year, and it would misrender a series whose data ends in the
// past (e.g. a frozen export) even right now.
export function getCutoffDate(range: ChartRange, lastDate: string): string | null {
  if (range === "MAX") return null; // no lower bound — include everything

  const last = parseLocalDate(lastDate);

  if (range === "YTD") {
    return `${last.getFullYear()}-01-01`;
  }

  const cutoff = new Date(last);
  switch (range) {
    case "3M":
      cutoff.setMonth(cutoff.getMonth() - 3);
      break;
    case "6M":
      cutoff.setMonth(cutoff.getMonth() - 6);
      break;
    case "1Y":
      cutoff.setFullYear(cutoff.getFullYear() - 1);
      break;
    case "3Y":
      cutoff.setFullYear(cutoff.getFullYear() - 3);
      break;
    case "5Y":
      cutoff.setFullYear(cutoff.getFullYear() - 5);
      break;
    case "10Y":
      cutoff.setFullYear(cutoff.getFullYear() - 10);
      break;
  }
  return formatLocalDate(cutoff);
}

// Lexicographic comparison is valid (and preferred over Date construction)
// for "YYYY-MM-DD" strings — mirrors lib/net-worth-history.ts's own sort.
// The cutoff is derived from the series' last point, so it always includes
// at least that point; an empty result only happens for an empty series.
export function filterSeriesByRange(series: NetWorthPoint[], range: ChartRange): NetWorthPoint[] {
  if (series.length === 0) return series;
  const lastDate = series[series.length - 1].date;
  const cutoff = getCutoffDate(range, lastDate);
  return cutoff === null ? series : series.filter((p) => p.date >= cutoff);
}

// Y domain from data extent, padded for breathing room. Padding scales both
// ends together so it never flips the domain's sign at either end — if the
// data crosses zero, the padded domain still crosses zero.
export function computeYDomain(values: number[]): [number, number] {
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const span = dataMax - dataMin;
  // A flat series (one point, or every value identical) has zero span; pad
  // by a fraction of the value itself (or a fixed $1 floor at exactly zero)
  // so the domain doesn't collapse into a divide-by-zero downstream.
  const pad = span > 0 ? span * DOMAIN_PADDING_RATIO : Math.max(Math.abs(dataMax) * DOMAIN_PADDING_RATIO, 1);
  return [dataMin - pad, dataMax + pad];
}

function makeXScale(times: number[], left: number, right: number): (t: number) => number {
  const first = times[0];
  const last = times[times.length - 1];
  const span = last - first || 1; // single point, or every point on the same day
  return (t: number) => left + ((t - first) / span) * (right - left);
}

function makeYScale(domain: [number, number], top: number, bottom: number): (v: number) => number {
  const [min, max] = domain;
  const span = max - min || 1;
  return (v: number) => bottom - ((v - min) / span) * (bottom - top);
}

// One pass, array-join instead of repeated string concatenation — the
// series can be ~2,250 points (Task 6's real-data estimate) and this runs
// on every range toggle.
export function buildPathD(coords: Array<{ x: number; y: number }>): string {
  if (coords.length < 2) return ""; // a single point has no line to draw
  const commands = new Array<string>(coords.length);
  for (let i = 0; i < coords.length; i++) {
    const { x, y } = coords[i];
    commands[i] = `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
  }
  return commands.join(" ");
}

// Binary search for the data index closest to `target` — O(log n) instead
// of a linear scan on every pointer-move over ~2,250 points.
export function nearestIndexForTime(times: number[], target: number): number {
  if (times.length === 0) return -1;
  if (target <= times[0]) return 0;
  if (target >= times[times.length - 1]) return times.length - 1;

  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  const before = lo - 1;
  if (before < 0) return lo;
  return target - times[before] <= times[lo] - target ? before : lo;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  series: NetWorthPoint[];
}

export default function NetWorthChart({ series }: Props) {
  const [range, setRange] = useState<ChartRange>(DEFAULT_RANGE);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const containerRef = useRef<HTMLDivElement>(null);

  // happy-dom (this repo's unit test environment) has no layout engine, so
  // ResizeObserver either doesn't exist or never reports a real size.
  // Guard its existence rather than assume it, and keep the default width
  // when it's missing — no polyfill; the chart is fully functional at a
  // fixed width, it just won't track container resizes.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const filtered = useMemo(() => filterSeriesByRange(series, range), [series, range]);

  // A stale hover index from a wider range could point past the end of a
  // narrower one — drop it whenever the visible point set changes.
  useEffect(() => {
    setHoverIndex(null);
  }, [range, series]);

  const innerWidth = Math.max(width - MARGIN.left - MARGIN.right, 1);
  const left = MARGIN.left;
  const right = left + innerWidth;
  const top = MARGIN.top;
  const bottom = HEIGHT - MARGIN.bottom;

  const times = useMemo(() => filtered.map((p) => parseLocalDate(p.date).getTime()), [filtered]);
  const domain = useMemo(() => computeYDomain(filtered.map((p) => p.value)), [filtered]);
  const crossesZero = domain[0] < 0 && domain[1] > 0;

  const xScale = useMemo(() => makeXScale(times, left, right), [times, left, right]);
  const yScale = useMemo(() => makeYScale(domain, top, bottom), [domain, top, bottom]);

  const coords = useMemo(
    () => filtered.map((p, i) => ({ x: xScale(times[i]), y: yScale(p.value) })),
    [filtered, times, xScale, yScale],
  );
  const pathD = useMemo(() => buildPathD(coords), [coords]);

  function handlePointerMove(e: React.MouseEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    // No real layout (e.g. happy-dom in tests) — nothing meaningful to compute.
    if (rect.width === 0 || times.length === 0) return;
    const ratio = (e.clientX - rect.left) / rect.width;
    const target = times[0] + ratio * (times[times.length - 1] - times[0]);
    setHoverIndex(nearestIndexForTime(times, target));
  }

  if (series.length === 0) {
    return (
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
        <h2 className="text-sm font-medium text-gray-500 mb-4">Net Worth Over Time</h2>
        <div
          data-state="empty"
          data-point-count={0}
          className="flex items-center justify-center h-40 text-sm text-gray-400 italic"
        >
          No net worth history yet.
        </div>
      </div>
    );
  }

  const hovered = hoverIndex !== null ? filtered[hoverIndex] : null;
  const hoveredCoord = hoverIndex !== null ? coords[hoverIndex] : null;

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-medium text-gray-500">Net Worth Over Time</h2>
        <div role="group" aria-label="Chart range" className="flex gap-1">
          {RANGE_KEYS.map((r) => {
            const isActive = r === range;
            return (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                aria-pressed={isActive}
                data-range={isActive ? r : undefined}
                className={
                  isActive
                    ? "px-2 py-1 text-xs font-medium rounded-md bg-gray-800 text-white"
                    : "px-2 py-1 text-xs font-medium rounded-md text-gray-500 hover:bg-gray-100"
                }
              >
                {r}
              </button>
            );
          })}
        </div>
      </div>

      <div
        ref={containerRef}
        data-point-count={filtered.length}
        data-crosses-zero={crossesZero}
        className="w-full relative"
      >
        <svg width={width} height={HEIGHT} role="img" aria-label="Net worth over time chart">
          {/* Zero reference line — only meaningful when the visible range actually
              straddles zero. For this user that's the ordinary case (a mortgage
              predating other assets), not an edge case, so it needs to read
              clearly rather than merely "not crash." */}
          {crossesZero && (
            <line
              x1={left}
              x2={right}
              y1={yScale(0)}
              y2={yScale(0)}
              className="stroke-gray-300"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          )}

          <text x={left} y={top + 4} textAnchor="start" className="fill-gray-400 text-[10px]">
            {compactCurrencyFormatter.format(domain[1])}
          </text>
          <text x={left} y={bottom} textAnchor="start" className="fill-gray-400 text-[10px]">
            {compactCurrencyFormatter.format(domain[0])}
          </text>

          {pathD !== "" && <path d={pathD} fill="none" className="stroke-blue-600" strokeWidth={2} />}

          {filtered.length === 1 && <circle cx={coords[0].x} cy={coords[0].y} r={3} className="fill-blue-600" />}

          <text x={left} y={HEIGHT - 4} textAnchor="start" className="fill-gray-400 text-[10px]">
            {axisDateFormatter.format(parseLocalDate(filtered[0].date))}
          </text>
          <text x={right} y={HEIGHT - 4} textAnchor="end" className="fill-gray-400 text-[10px]">
            {axisDateFormatter.format(parseLocalDate(filtered[filtered.length - 1].date))}
          </text>

          <rect
            x={left}
            y={top}
            width={innerWidth}
            height={Math.max(bottom - top, 0)}
            fill="transparent"
            onMouseMove={handlePointerMove}
            onMouseLeave={() => setHoverIndex(null)}
          />

          {hoveredCoord && (
            <>
              <line
                x1={hoveredCoord.x}
                x2={hoveredCoord.x}
                y1={top}
                y2={bottom}
                className="stroke-gray-300"
                strokeWidth={1}
              />
              <circle cx={hoveredCoord.x} cy={hoveredCoord.y} r={4} className="fill-blue-600" />
            </>
          )}
        </svg>

        {hovered && hoveredCoord && (
          <div
            className="absolute pointer-events-none bg-gray-800 text-white text-xs rounded-md px-2 py-1 shadow-lg"
            style={{ left: hoveredCoord.x, top: hoveredCoord.y - 36 }}
          >
            <p className="font-medium">{currencyFormatter.format(hovered.value)}</p>
            <p className="text-gray-300">{tooltipDateFormatter.format(parseLocalDate(hovered.date))}</p>
          </div>
        )}
      </div>
    </div>
  );
}
