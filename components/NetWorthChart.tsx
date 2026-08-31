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

// Adds `deltaMonths` calendar months to `date`, clamping the resulting day
// to the target month's last day instead of letting JS Date overflow into
// the *following* month — e.g. May 31 minus 3 calendar months naively lands
// on Mar 3 (Date.setMonth keeps day=31, and Feb only has 28, so it rolls
// forward), not the intended late February. Building the target month at
// day 1 sidesteps the overflow ambiguity entirely (day 1 always exists in
// every month), then the original day is clamped down to whatever the
// target month can actually hold — which also correctly handles a Feb 29
// last date landing on a non-leap target year.
function addMonthsClamped(date: Date, deltaMonths: number): Date {
  const day = date.getDate();
  const target = new Date(date.getFullYear(), date.getMonth() + deltaMonths, 1);
  const daysInTargetMonth = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, daysInTargetMonth));
  return target;
}

const MONTHS_BACK: Record<Exclude<ChartRange, "MAX" | "YTD">, number> = {
  "3M": 3,
  "6M": 6,
  "1Y": 12,
  "3Y": 36,
  "5Y": 60,
  "10Y": 120,
};

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

  return formatLocalDate(addMonthsClamped(last, -MONTHS_BACK[range]));
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
  // The component only ever calls this with an empty array via the
  // series.length === 0 branch's hooks running before that branch's early
  // return (hooks can't be called conditionally) — the empty-state JSX never
  // reads the result, but guard explicitly rather than lean on that, so
  // Math.min(...[])/Math.max(...[]) (±Infinity) never gets a chance to turn
  // into NaN through the padding math below.
  if (values.length === 0) return [0, 0];

  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const span = dataMax - dataMin;
  // A flat series (one point, or every value identical) has zero span; pad
  // by a fraction of the value itself (or a fixed $1 floor at exactly zero)
  // so the domain doesn't collapse into a divide-by-zero downstream.
  const pad = span > 0 ? span * DOMAIN_PADDING_RATIO : Math.max(Math.abs(dataMax) * DOMAIN_PADDING_RATIO, 1);
  return [dataMin - pad, dataMax + pad];
}

// Whether the series crosses zero, from the *raw* data extent — not the
// padded domain computeYDomain returns. Padding only ever widens the
// domain, so it can push an all-positive series' floor below zero (e.g.
// $1,000-$100,000: an 8% pad dips the floor to -$6,920) and draw a zero
// line the data never actually touches — most misleadingly right around
// the years where a real crossing would matter most.
export function seriesCrossesZero(values: number[]): boolean {
  if (values.length === 0) return false;
  return Math.min(...values) < 0 && Math.max(...values) > 0;
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

  // times/domain feed xScale/yScale below; when filtered is [] (only
  // reachable via the series.length === 0 branch, whose early return sits
  // below these hooks) coords ends up [] too, since .map on [] never invokes
  // the scale functions — so an undefined-tainted scale here never actually
  // produces a value anything reads.
  const times = useMemo(() => filtered.map((p) => parseLocalDate(p.date).getTime()), [filtered]);
  const values = useMemo(() => filtered.map((p) => p.value), [filtered]);
  const domain = useMemo(() => computeYDomain(values), [values]);
  // From the raw data extent, not the padded domain — see seriesCrossesZero's
  // own comment for why that distinction matters.
  const crossesZero = useMemo(() => seriesCrossesZero(values), [values]);

  const xScale = useMemo(() => makeXScale(times, left, right), [times, left, right]);
  const yScale = useMemo(() => makeYScale(domain, top, bottom), [domain, top, bottom]);

  const coords = useMemo(
    () => filtered.map((p, i) => ({ x: xScale(times[i]), y: yScale(p.value) })),
    [filtered, times, xScale, yScale],
  );
  const pathD = useMemo(() => buildPathD(coords), [coords]);

  // The last index is a reasonable default "current value" for a slider
  // that hasn't been moved yet — most recent net worth is the number a user
  // reaching this control by keyboard is most likely to want first.
  const activeIndex = hoverIndex ?? Math.max(filtered.length - 1, 0);
  const activePoint = filtered.length > 0 ? filtered[activeIndex] : null;
  const activeValueText = activePoint
    ? `${tooltipDateFormatter.format(parseLocalDate(activePoint.date))}: ${currencyFormatter.format(activePoint.value)}`
    : "";

  function handlePointerMove(e: React.MouseEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    // No real layout (e.g. happy-dom in tests) — nothing meaningful to compute.
    if (rect.width === 0 || times.length === 0) return;
    const ratio = (e.clientX - rect.left) / rect.width;
    const target = times[0] + ratio * (times[times.length - 1] - times[0]);
    setHoverIndex(nearestIndexForTime(times, target));
  }

  // Keyboard path onto the same hoverIndex state the mouse drives, so both
  // modalities share one tooltip/live-region code path rather than diverging.
  function handleKeyDown(e: React.KeyboardEvent<SVGRectElement>) {
    if (filtered.length === 0) return;
    const current = hoverIndex ?? filtered.length - 1;
    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        setHoverIndex(Math.max(current - 1, 0));
        break;
      case "ArrowRight":
        e.preventDefault();
        setHoverIndex(Math.min(current + 1, filtered.length - 1));
        break;
      case "Home":
        e.preventDefault();
        setHoverIndex(0);
        break;
      case "End":
        e.preventDefault();
        setHoverIndex(filtered.length - 1);
        break;
      default:
        break;
    }
  }

  // Focusing the control (Tab) reveals its current value immediately, same
  // as a native <input type="range"> would — arrow keys then move it.
  function handleFocus() {
    setHoverIndex((prev) => prev ?? Math.max(filtered.length - 1, 0));
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

  // The only non-hover, non-keyboard way to read a number off this chart —
  // covers the same ground as the visible axis labels (domain extent, first/
  // last point) in one sentence rather than four disconnected SVG <text>
  // fragments. Static (not live) so it's available the instant the chart
  // renders, before any interaction.
  const firstPoint = filtered[0];
  const lastPoint = filtered[filtered.length - 1];
  const chartSummary =
    `Net worth chart, ${range} range, ${filtered.length} data point${filtered.length === 1 ? "" : "s"}. ` +
    `From ${tooltipDateFormatter.format(parseLocalDate(firstPoint.date))} ` +
    `(${currencyFormatter.format(firstPoint.value)}) to ` +
    `${tooltipDateFormatter.format(parseLocalDate(lastPoint.date))} ` +
    `(${currencyFormatter.format(lastPoint.value)}). ` +
    `Values range from ${currencyFormatter.format(domain[0])} to ${currencyFormatter.format(domain[1])}.`;

  // Only speaks up once the user actually moves the control (mouse hover or
  // arrow keys) — the static summary above already covers the unmoved state,
  // so this doesn't double-announce on mount or on bare focus.
  const liveAnnouncement = hoverIndex !== null ? activeValueText : "";

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
        {/* Static, non-live equivalent of the visible axis labels — role="img"
            on an ancestor would prune the SVG's <text> descendants from the
            accessibility tree, so this lives outside the SVG instead of
            depending on that pruned content ever being exposed. */}
        <p className="sr-only">{chartSummary}</p>

        <svg width={width} height={HEIGHT}>
          {/* Every purely-decorative visual lives in this group. It's
              deliberately aria-hidden: the sr-only summary above and the
              live region below already carry this same information in a
              screen-reader-appropriate form, and the one truly interactive
              element (the slider <rect> below) is a sibling, not a
              descendant, so hiding this group doesn't also hide it. */}
          <g aria-hidden="true">
            {/* Zero reference line — only meaningful when the visible range
                actually straddles zero. For this user that's the ordinary
                case (a mortgage predating other assets), not an edge case,
                so it needs to read clearly rather than merely "not crash." */}
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
          </g>

          {/* The one interactive element: a keyboard- and pointer-operable
              slider over the visible points. role="slider" plus the
              aria-value* triad gives assistive tech a value even before any
              interaction (defaulting to the most recent point) — same as a
              native <input type="range"> announces its value on focus. */}
          <rect
            x={left}
            y={top}
            width={innerWidth}
            height={Math.max(bottom - top, 0)}
            fill="transparent"
            tabIndex={0}
            role="slider"
            aria-label="Net worth value explorer"
            aria-orientation="horizontal"
            aria-valuemin={0}
            aria-valuemax={Math.max(filtered.length - 1, 0)}
            aria-valuenow={activeIndex}
            aria-valuetext={activeValueText}
            onMouseMove={handlePointerMove}
            onMouseLeave={() => setHoverIndex(null)}
            onFocus={handleFocus}
            onBlur={() => setHoverIndex(null)}
            onKeyDown={handleKeyDown}
          />
        </svg>

        {/* Decorative duplicate of the live region's text for sighted mouse/
            keyboard users — aria-hidden so it isn't announced twice. */}
        {hovered && hoveredCoord && (
          <div
            aria-hidden="true"
            className="absolute pointer-events-none bg-gray-800 text-white text-xs rounded-md px-2 py-1 shadow-lg"
            style={{ left: hoveredCoord.x, top: hoveredCoord.y - 36 }}
          >
            <p className="font-medium">{currencyFormatter.format(hovered.value)}</p>
            <p className="text-gray-300">{tooltipDateFormatter.format(parseLocalDate(hovered.date))}</p>
          </div>
        )}

        <p aria-live="polite" className="sr-only">
          {liveAnnouncement}
        </p>
      </div>
    </div>
  );
}
