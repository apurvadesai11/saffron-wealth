import type { NetWorthSummary } from "@/lib/types";
import { formatUsd } from "@/lib/money";

interface Props {
  summary: NetWorthSummary;
}

export default function NetWorthSummaryCards({ summary }: Props) {
  const { totalAssets, totalLiabilities, netWorth } = summary;

  return (
    <div className="grid grid-cols-3 gap-4">
      <div
        className="bg-surface rounded-xl p-4 shadow-sm border border-line-subtle"
        data-net-worth-sign={netWorth >= 0 ? "positive" : "negative"}
      >
        <p className="text-sm text-fg-muted mb-1">Net Worth</p>
        <p className={`text-2xl font-bold ${netWorth >= 0 ? "text-success" : "text-danger"}`}>
          {formatUsd(netWorth)}
        </p>
      </div>
      <div className="bg-surface rounded-xl p-4 shadow-sm border border-line-subtle">
        <p className="text-sm text-fg-muted mb-1">Total Assets</p>
        <p className="text-2xl font-bold text-success">{formatUsd(totalAssets)}</p>
      </div>
      <div className="bg-surface rounded-xl p-4 shadow-sm border border-line-subtle">
        <p className="text-sm text-fg-muted mb-1">Total Liabilities</p>
        <p className="text-2xl font-bold text-danger">{formatUsd(totalLiabilities)}</p>
      </div>
    </div>
  );
}
