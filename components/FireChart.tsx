"use client";

import { useEffect, useRef, useState } from "react";
import type { FireSummary } from "@/lib/fire-simulation";
import {
  DEFAULT_WIDTH,
  buildPathD,
  compactCurrencyFormatter,
  currencyFormatter,
  makeYScale,
} from "./NetWorthChart";

// Hand-rolled SVG, same approach as NetWorthChart: geometry lives in pure
// exported helpers because happy-dom has no layout to test the rendered
// result against. Read-only by design (no hover or keyboard explorer): the
// numbers that matter are on the page around it, and the aria-label carries
// the neutral path for anyone who can't see the picture.

const HEIGHT = 300;
// Taller bottom margin than NetWorthChart: this one has a tick row and an
// axis caption, where that one has two date labels.
const MARGIN = { top: 16, right: 16, bottom: 36, left: 64 };

// Headroom above the highest line so it doesn't sit on the edge of the plot.
const DOMAIN_PADDING_RATIO = 0.08;

const Y_TICK_TARGET = 4;
const X_TICK_TARGET = 6;

type Bands = FireSummary["bands"];

// ---------------------------------------------------------------------------
// Pure geometry
// ---------------------------------------------------------------------------

// The y range that shows the band, the FI line and (when drawn) the coast
// curve. Anchored at zero rather than at the data's minimum, unlike
// computeYDomain: this chart answers "how far am I from the target", and a
// floor above zero would exaggerate the progress. It reaches below zero only
// when a path actually goes negative.
//
// Non-finite coast entries are skipped, not read as zero: coastFiNumber is
// null at the target age, and a stray null must not drag the floor.
export function yDomain(
  bands: Bands,
  fiNumber: number,
  coastLine: number[] | null,
): [number, number] {
  const values = [fiNumber, ...bands.flatMap((b) => [b.p10, b.p90]), ...(coastLine ?? [])].filter(
    Number.isFinite,
  );
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min;
  const pad = span > 0 ? span * DOMAIN_PADDING_RATIO : 1; // all-zero data still needs a non-empty range
  return [min < 0 ? min - pad : 0, max + pad];
}

// The p10-p90 area as one closed path: out along p90, back along p10. `x` maps
// years-from-now and `y` maps dollars, so the caller owns the scales. Going
// through buildPathD keeps the point formatting identical to the median line's.
export function bandPath(bands: Bands, x: (year: number) => number, y: (value: number) => number): string {
  if (bands.length < 2) return ""; // a single year has no area to fill
  const upper = bands.map((b) => ({ x: x(b.year), y: y(b.p90) }));
  const lower = bands.map((b) => ({ x: x(b.year), y: y(b.p10) })).reverse();
  return `${buildPathD([...upper, ...lower])} Z`;
}

// Round values (1, 2, 5 times a power of ten) inside [min, max], about `target`
// of them. Used for both axes: on the x axis it makes the labels round ages
// (40, 45, 50) instead of "age now plus 5, 10, 15".
export function niceTicks([min, max]: [number, number], target: number): number[] {
  const span = max - min;
  if (!(span > 0)) return Number.isFinite(min) ? [min] : [];

  const rough = span / target;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? 10 * magnitude;

  const ticks: number[] = [];
  // Multiply the index rather than accumulating the step, so 0.1-style steps
  // don't drift. `|| 0` turns the -0 that ceil(-0.6) * step produces into 0,
  // which would otherwise format as "-$0".
  for (let i = Math.ceil(min / step); i * step <= max + step * 1e-9; i++) ticks.push(i * step || 0);
  return ticks;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  bands: Bands;
  age: number;
  fiNumber: number;
  // coastLine[k] = coastFiNumber(F, r, T - k), aligned with bands[k]. Only
  // drawn in the coast view.
  coastLine: number[] | null;
  view: "fi" | "coast";
}

export default function FireChart({ bands, age, fiNumber, coastLine, view }: Props) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const containerRef = useRef<HTMLDivElement>(null);

  // Same guard as NetWorthChart: happy-dom has no ResizeObserver worth
  // trusting, so the chart is fully usable at DEFAULT_WIDTH without it.
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

  if (bands.length < 2) {
    return (
      <div
        data-state="empty"
        className="flex items-center justify-center h-40 text-sm text-fg-faint italic"
      >
        No projection to chart yet.
      </div>
    );
  }

  const coast = view === "coast" ? coastLine : null;
  const domain = yDomain(bands, fiNumber, coast);

  const left = MARGIN.left;
  const right = left + Math.max(width - MARGIN.left - MARGIN.right, 1);
  const top = MARGIN.top;
  const bottom = HEIGHT - MARGIN.bottom;

  const firstYear = bands[0].year;
  const lastBand = bands[bands.length - 1];
  const yearSpan = lastBand.year - firstYear || 1;
  const xScale = (year: number) => left + ((year - firstYear) / yearSpan) * (right - left);
  const yScale = makeYScale(domain, top, bottom);

  const medianD = buildPathD(bands.map((b) => ({ x: xScale(b.year), y: yScale(b.p50) })));
  const bandD = bandPath(bands, xScale, yScale);
  // Index k lines up with bands[k]; a coast line longer than the bands has
  // nothing to be drawn against.
  const coastD = buildPathD(
    (coast ?? []).slice(0, bands.length).flatMap((value, k) =>
      Number.isFinite(value) ? [{ x: xScale(bands[k].year), y: yScale(value) }] : [],
    ),
  );

  const fiY = yScale(fiNumber);
  const yTicks = niceTicks(domain, Y_TICK_TARGET);
  const ageTicks = niceTicks([age + firstYear, age + lastBand.year], X_TICK_TARGET);

  const summary =
    `Median projection reaches ${currencyFormatter.format(lastBand.p50)} by age ${age + lastBand.year}. ` +
    `FI number is ${currencyFormatter.format(fiNumber)}.`;

  return (
    <div ref={containerRef} data-view={view} className="w-full">
      <svg width={width} height={HEIGHT} role="img" aria-label={summary}>
        {yTicks.map((tick) => (
          <g key={tick}>
            <line x1={left} x2={right} y1={yScale(tick)} y2={yScale(tick)} className="stroke-line" strokeWidth={1} />
            <text x={left - 8} y={yScale(tick) + 3} textAnchor="end" className="fill-fg-faint text-[10px]">
              {compactCurrencyFormatter.format(tick)}
            </text>
          </g>
        ))}

        {ageTicks.map((tick) => (
          <text key={tick} x={xScale(tick - age)} y={bottom + 14} textAnchor="middle" className="fill-fg-faint text-[10px]">
            {tick}
          </text>
        ))}
        <text x={(left + right) / 2} y={HEIGHT - 4} textAnchor="middle" className="fill-fg-faint text-[10px]">
          Age
        </text>

        {bandD !== "" && <path data-series="band" d={bandD} className="fill-accent-line/50" />}

        {coastD !== "" && (
          <path
            data-series="coast"
            d={coastD}
            fill="none"
            className="stroke-success"
            strokeWidth={2}
            strokeDasharray="2 4"
            strokeLinecap="round"
          />
        )}

        <line
          data-series="fi"
          x1={left}
          x2={right}
          y1={fiY}
          y2={fiY}
          className="stroke-warning"
          strokeWidth={1.5}
          strokeDasharray="6 4"
        />
        <text x={left + 4} y={fiY - 4} textAnchor="start" className="fill-warning-strong text-[10px]">
          FI number
        </text>

        {medianD !== "" && <path data-series="median" d={medianD} fill="none" className="stroke-accent" strokeWidth={2} />}
      </svg>

      {/* The band and the coast curve have no label on the plot itself. */}
      <ul className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-fg-muted">
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-2.5 w-4 rounded-sm bg-accent-line/50" />
          10th to 90th percentile
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-0.5 w-4 bg-accent" />
          Median
        </li>
        {coastD !== "" && (
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-0.5 w-4 bg-success" />
            Coast FI needed
          </li>
        )}
      </ul>
    </div>
  );
}
