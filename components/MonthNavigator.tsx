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
        className="text-gray-400 hover:text-gray-700 transition-colors text-xl leading-none px-1"
        aria-label="Previous month"
      >‹</button>
      <span className="text-sm font-medium text-gray-700 w-32 text-center">
        {MONTH_NAMES[month]} {year}
      </span>
      <button
        onClick={next}
        className="text-gray-400 hover:text-gray-700 transition-colors text-xl leading-none px-1"
        aria-label="Next month"
      >›</button>
    </div>
  );
}
