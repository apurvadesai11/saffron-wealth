"use client";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface Props {
  month: number;  // 0-11
  year: number;
  onChange: (month: number, year: number) => void;
}

export default function MonthNavigator({ month, year, onChange }: Props) {
  // Read on each render rather than once, so a page left open past midnight
  // at month's end still knows which month "today" is.
  const now = new Date();
  const showingToday = month === now.getMonth() && year === now.getFullYear();

  function prev() {
    if (month === 0) onChange(11, year - 1);
    else onChange(month - 1, year);
  }
  function next() {
    if (month === 11) onChange(0, year + 1);
    else onChange(month + 1, year);
  }

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={prev}
        className="text-fg-faint hover:text-fg-secondary transition-colors text-xl leading-none px-1"
        aria-label="Previous month"
      >‹</button>
      <span className="text-sm font-medium text-fg-secondary w-32 text-center">
        {MONTH_NAMES[month]} {year}
      </span>
      <button
        onClick={next}
        className="text-fg-faint hover:text-fg-secondary transition-colors text-xl leading-none px-1"
        aria-label="Next month"
      >›</button>
      <button
        onClick={() => onChange(now.getMonth(), now.getFullYear())}
        disabled={showingToday}
        className="ml-1 px-2 py-1 rounded-lg border border-line text-xs font-medium text-fg-secondary hover:bg-surface-sunken transition-colors disabled:opacity-50 disabled:hover:bg-transparent"
      >
        Today
      </button>
    </div>
  );
}
