import type { ScenarioRow } from "@/lib/fire-simulation";

interface Props {
  rows: ScenarioRow[];
  view: "fi" | "coast";
  age: number;
  asOfYear: number;
  horizon: number;
  windowCount: number;
  firstStartYear: number;
  lastStartYear: number;
  // A fraction (0 to 1) of the historical starts; shown as a percent.
  share: number;
}

/**
 * "14 yrs 2 mo". Months are rounded from the total so a remainder that rounds
 * up to twelve carries into the years (14.97 reads "15 yrs 0 mo", not
 * "14 yrs 12 mo"). A figure that rounds to zero months is "Now".
 */
export function formatYears(years: number | null, horizon: number): string {
  if (years === null) return `Not within ${horizon} years`;
  const totalMonths = Math.round(years * 12);
  if (totalMonths === 0) return "Now";
  return `${Math.floor(totalMonths / 12)} yrs ${totalMonths % 12} mo`;
}

const headerClass = "py-2 pr-4 text-left font-medium text-fg-muted";
const cellClass = "py-2 pr-4 tabular-nums";

// The five percentile scenarios of the historical replay, for whichever
// milestone the page is showing. The age and year are floors: they name the
// age you are in, and the calendar year it falls in, when the milestone is
// crossed.
export default function FireScenarioTable({
  rows,
  view,
  age,
  asOfYear,
  horizon,
  windowCount,
  firstStartYear,
  lastStartYear,
  share,
}: Props) {
  const percent = Math.round(share * 100);
  // The windows overlap (each starts a year after the last), so this is a
  // description of the history replayed, not the odds of the future.
  const summary =
    view === "fi"
      ? `${percent}% of historical starts reach FI by your target age`
      : `${percent}% of historical starts are already Coast FI`;

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
              <td className={cellClass}>{formatYears(row.years, horizon)}</td>
              <td className={cellClass}>{row.years === null ? "—" : Math.floor(age + row.years)}</td>
              <td className={cellClass}>{row.years === null ? "—" : Math.floor(asOfYear + row.years)}</td>
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
