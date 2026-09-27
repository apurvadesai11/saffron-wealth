import type { NetWorthSummary } from "@/lib/types";

interface Props {
  summary: NetWorthSummary;
}

export default function NetWorthSummaryCards({ summary }: Props) {
  const { totalAssets, totalLiabilities, netWorth } = summary;

  return (
    <div className="grid grid-cols-3 gap-4">
      <div
        className="bg-white rounded-xl p-4 shadow-sm border border-gray-100"
        data-net-worth-sign={netWorth >= 0 ? "positive" : "negative"}
      >
        <p className="text-sm text-gray-500 mb-1">Net Worth</p>
        <p className={`text-2xl font-bold ${netWorth >= 0 ? "text-green-600" : "text-red-600"}`}>
          ${netWorth.toFixed(2)}
        </p>
      </div>
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
        <p className="text-sm text-gray-500 mb-1">Total Assets</p>
        <p className="text-2xl font-bold text-green-600">${totalAssets.toFixed(2)}</p>
      </div>
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
        <p className="text-sm text-gray-500 mb-1">Total Liabilities</p>
        <p className="text-2xl font-bold text-red-600">${totalLiabilities.toFixed(2)}</p>
      </div>
    </div>
  );
}
