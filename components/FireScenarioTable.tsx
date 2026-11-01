import type { ScenarioRow } from "@/lib/fire-simulation";

interface Props {
  rows: ScenarioRow[];
  view: "fi" | "coast";
  age: number;
  targetRetirementAge: number;
  // True once the target age is behind the user: there is then no "by your
  // target age" for the FI view's share to count.
  pastTarget?: boolean;
  // "YYYY-MM-DD", as in FireInputs.asOf.
  asOf: string;
  horizon: number;
  windowCount: number;
  firstStartYear: number;
  lastStartYear: number;
  // A fraction (0 to 1) of the historical starts; shown as a percent.
  share: number;
}

/**
 * "14 yrs 2 mos", or "1 yr 1 mo". Months are rounded from the total so a
 * remainder that rounds up to twelve carries into the years (14.97 reads
 * "15 yrs 0 mos", not "14 yrs 12 mos"). A figure that rounds to zero months
 * is "Now".
 */
export function formatYears(years: number | null, horizon: number): string {
  if (years === null) return `Not within ${horizon} years`;
  const totalMonths = Math.round(years * 12);
  if (totalMonths === 0) return "Now";
  const wholeYears = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  return `${wholeYears} ${wholeYears === 1 ? "yr" : "yrs"} ${months} ${months === 1 ? "mo" : "mos"}`;
}

// The calendar year of the month a milestone `years` from `asOf` falls in.
// It counts the same rounded months formatYears prints, from asOf's own month,
// so October 2026 plus "5 yrs 10 mos" is 2032 (adding 5.83 to 2026 says 2031).
function milestoneYear(asOf: string, years: number): number {
  const year = Number(asOf.slice(0, 4));
  const month = Number(asOf.slice(5, 7));
  return year + Math.floor((month - 1 + Math.round(years * 12)) / 12);
}

const headerClass = "py-2 pr-4 text-left font-medium text-fg-muted";
const cellClass = "py-2 pr-4 tabular-nums";

// The five percentile scenarios of the historical replay, for whichever
// milestone the page is showing. The age is a floor: the age you are in when
// the milestone is crossed. The year is the calendar year of the month it is
// crossed in, counted from today's month (see milestoneYear).
export default function FireScenarioTable({
  rows,
  view,
  age,
  targetRetirementAge,
  pastTarget = false,
  asOf,
  horizon,
  windowCount,
  firstStartYear,
  lastStartYear,
  share,
}: Props) {
  const percent = Math.round(share * 100);
  // The windows overlap (each starts a year after the last), so this is a
  // description of the history replayed, not the odds of the future. Past the
  // target age the share would be 0% by construction, and saying so would read
  // as a verdict on the plan.
  let summary: string;
  if (view === "coast") summary = `${percent}% of historical starts are already Coast FI`;
  else if (pastTarget) summary = "The share reaching FI is measured against your target age, and you are past it.";
  else summary = `${percent}% of historical starts reach FI by your target age`;

  // Coast FI is crossed by the target age or not at all, so a start that never
  // crosses it is named by that age, not by the simulation's horizon.
  const formatRowYears = (years: number | null) =>
    years === null && view === "coast" ? `Not by age ${targetRetirementAge}` : formatYears(years, horizon);

  return (
    <div>
      <p className="text-sm font-medium text-fg">{summary}</p>
      <table className="mt-3 w-full text-sm text-fg">
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className={headerClass}>
              Scenario
            </th>
            <th scope="col" className={headerClass}>
              Years
            </th>
            <th scope="col" className={headerClass}>
              Age
            </th>
            <th scope="col" className={headerClass}>
              Year
            </th>
            <th scope="col" className={headerClass}>
              Like starting in
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} data-scenario={row.label} className="border-b border-line-subtle last:border-b-0">
              <td className={`${cellClass} font-medium`}>{row.label}</td>
              <td className={cellClass}>{formatRowYears(row.years)}</td>
              <td className={cellClass}>{row.years === null ? "—" : Math.floor(age + row.years)}</td>
              <td className={cellClass}>{row.years === null ? "—" : milestoneYear(asOf, row.years)}</td>
              <td className={cellClass}>{row.startYear}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-fg-muted">
        {windowCount} historical windows of {horizon} years, starting {firstStartYear}–{lastStartYear}
      </p>
    </div>
  );
}
