import type { ReactNode } from "react";
import type { FireInputs, FireLevers } from "@/lib/types";
import {
  afterTaxIncome,
  annualContribution,
  fiNumber,
  hasIncome,
  hasTaxRate,
  realReturn,
  savingsRatePct,
  type ReadyLevers,
} from "@/lib/fire-levers";
import { purchaseLifeYears } from "@/lib/fire-spending";
import { MARKET_HISTORY_SOURCE } from "@/lib/market-history-data";
import { formatUsd } from "@/lib/money";

interface Props {
  inputs: FireInputs;
  // The levers in use now, and the ones the page started from. A row says it
  // was adjusted when its lever has moved off its default, so the panel never
  // describes a number the plan is not using as if it were still the measured one.
  levers: ReadyLevers;
  defaults: FireLevers;
  history: { windowCount: number; firstStartYear: number; lastStartYear: number; horizon: number };
}

// The blended series is recentred to the return lever whatever the mix (decision
// 0015), so the allocation moves only the spread of outcomes. People expect
// more stocks to mean more return, so the slider and its row both say so.
export const ALLOCATION_HINT =
  "Changes how bumpy the path is, not the average return — the return slider sets that for the whole mix.";

// Percents as typed, without float dust or trailing zeros: 5 reads "5",
// 7.1000000000000005 reads "7.1".
function pct(value: number, digits = 2): string {
  return String(Number(value.toFixed(digits)));
}

// Every row says where its number came from, and flags the ones the user
// has moved off their starting value. A tax rate the user had to supply is
// its own starting value once entered: sitting on it is not an adjustment.
function Row({
  name,
  term,
  adjusted = false,
  children,
}: {
  name: string;
  term: string;
  adjusted?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      data-row={name}
      data-adjusted={adjusted ? "true" : "false"}
      className="py-3 sm:grid sm:grid-cols-3 sm:gap-4"
    >
      <dt className="text-sm font-medium text-fg-secondary">{term}</dt>
      <dd className="mt-1 space-y-1 text-sm text-fg sm:col-span-2 sm:mt-0">{children}</dd>
    </div>
  );
}

function Value({ children }: { children: ReactNode }) {
  return <span className="font-medium">{children}</span>;
}

function Source({ children }: { children: ReactNode }) {
  return <span className="text-fg-muted">{children}</span>;
}

// The marker for a lever the user has moved. It reads differently from a
// plain source so a changed assumption is easy to spot in a long list.
function Adjusted({ children }: { children: ReactNode }) {
  return <span className="text-accent">{children}</span>;
}

export default function FireAssumptions({ inputs, levers, defaults, history }: Props) {
  const { portfolio, spending, takeHome } = inputs;

  const spendingAdjusted = levers.annualSpending !== defaults.annualSpending;
  const taxAdjusted =
    defaults.effectiveTaxRatePct !== null && levers.effectiveTaxRatePct !== defaults.effectiveTaxRatePct;
  const returnAdjusted =
    levers.nominalReturnPct !== defaults.nominalReturnPct || levers.inflationPct !== defaults.inflationPct;
  const withdrawalAdjusted = levers.safeWithdrawalRatePct !== defaults.safeWithdrawalRatePct;
  const allocationAdjusted = levers.stockAllocationPct !== defaults.stockAllocationPct;

  const savingsRate = savingsRatePct(inputs, levers);
  const defaultSavingsRate = hasTaxRate(defaults) ? savingsRatePct(inputs, defaults) : null;
  const savingsAdjusted = defaultSavingsRate !== null && savingsRate !== defaultSavingsRate;

  // computeTakeHome gives null, not $0, when no income came in.
  const noIncomeTransactions = takeHome === null;
  const NO_INCOME_TRANSACTIONS = "No income transactions in the last 12 months";

  const derivedTax = inputs.derivedTaxRatePct;
  let taxSource: ReactNode;
  if (derivedTax === null) {
    // The page makes a submitted rate the default, so defaults holds it.
    const entered = defaults.effectiveTaxRatePct;
    taxSource = (
      <>
        {taxAdjusted && entered !== null ? (
          <Adjusted>{`adjusted by you (you entered ${pct(entered)}%)`}</Adjusted>
        ) : (
          <Source>entered by you</Source>
        )}
        {noIncomeTransactions && (
          <>
            {" "}
            <Source>{NO_INCOME_TRANSACTIONS}</Source>
          </>
        )}
      </>
    );
  } else if (taxAdjusted) {
    taxSource = <Adjusted>{`adjusted by you (estimate was ${pct(derivedTax)}%)`}</Adjusted>;
  } else if (noIncomeTransactions) {
    taxSource = <Source>{NO_INCOME_TRANSACTIONS}</Source>;
  } else {
    taxSource = (
      <Source>
        {/* takeHome.annual is a yearly run-rate, annualized from as few as six
            months, so the months say how much history it rests on. */}
        {`Estimated from your data: take-home ${formatUsd(takeHome.annual)}/yr (annualized from ${takeHome.months} months) + paycheck deductions ${formatUsd(inputs.payrollDeductions)}, against cash income ${formatUsd(inputs.cashIncome)}`}
      </Source>
    );
  }

  const purchaseCount = spending.amortized.length;

  return (
    <dl className="divide-y divide-line-subtle">
      <Row name="age" term="Age">
        <p>
          <Value>{inputs.age}</Value> now, retiring at <Value>{inputs.targetRetirementAge}</Value>{" "}
          <Source>from your Financial Profile</Source>
        </p>
      </Row>

      <Row name="portfolio" term="Investable portfolio">
        <p>
          <Value>{formatUsd(portfolio.total)}</Value>{" "}
          <Source>cash + investments + retirement − credit card debt</Source>
        </p>
        <ul className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          <li>
            <Source>Cash</Source> <span>{formatUsd(portfolio.cash)}</span>
          </li>
          <li>
            <Source>Investments</Source> <span>{formatUsd(portfolio.investments)}</span>
          </li>
          <li>
            <Source>Retirement</Source> <span>{formatUsd(portfolio.retirement)}</span>
          </li>
          <li>
            {/* Net owed: a card in credit is negative, and adds to the total. */}
            <Source>{portfolio.creditCardDebt >= 0 ? "Credit card debt (subtracted)" : "Credit card credit (added)"}</Source>{" "}
            <span>{formatUsd(Math.abs(portfolio.creditCardDebt))}</span>
          </li>
        </ul>
        <p>
          <Source>Excludes your home, mortgage, hidden, archived and uncategorized accounts</Source>
        </p>
      </Row>

      <Row name="spending" term="Annual spending" adjusted={spendingAdjusted}>
        <p>
          <Value>{formatUsd(levers.annualSpending)}</Value>{" "}
          {spendingAdjusted ? (
            <Adjusted>{`adjusted by you (measured ${formatUsd(spending.annualSpending)})`}</Adjusted>
          ) : (
            <Source>measured from your transactions</Source>
          )}
        </p>
        <p>
          {/* The baseline was restated to today's dollars on the server, past the
              last CPI month at the profile's inflation rate, so that rate is the one
              shown here rather than the inflation lever. */}
          <Source>
            {`${spending.months} months of history (${spending.fromMonth} – ${spending.toMonth}), in today's dollars (CPI through ${spending.cpiThrough}, then ${pct(inputs.profileInflationPct)}%/yr)`}
          </Source>
        </p>
        <p className="text-fg-muted">
          <span>{formatUsd(spending.regularAnnual)}</span> regular + <span>{formatUsd(spending.amortizedAnnual)}</span>{" "}
          from large one-off purchases
        </p>
        {purchaseCount > 0 && (
          <details>
            <summary className="cursor-pointer text-fg-muted">
              {`${purchaseCount} large one-off ${purchaseCount === 1 ? "purchase" : "purchases"} smoothed over ${pct(purchaseLifeYears(spending.months), 1)} years`}
            </summary>
            <ul className="mt-2 space-y-1">
              {spending.amortized.map((purchase) => (
                <li
                  key={`${purchase.date}-${purchase.description}-${purchase.amount}`}
                  className="flex flex-wrap justify-between gap-x-4"
                >
                  <span>
                    {purchase.date} · {purchase.description}
                  </span>
                  <span className="text-fg-muted">
                    {formatUsd(purchase.amount)} · {formatUsd(purchase.annualized)}/yr
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Row>

      <Row name="income" term="Income" adjusted={taxAdjusted}>
        <p>
          <Value>{formatUsd(inputs.grossIncome)}</Value> <Source>gross income, from your Financial Profile</Source>
        </p>
        {inputs.excludedPassiveIncome > 0 && (
          <p>
            <Source>
              {`Interest & dividends ${formatUsd(inputs.excludedPassiveIncome)} left out: the historical returns already reinvest them`}
            </Source>
          </p>
        )}
        <p>
          {hasIncome(inputs) ? (
            <>
              Effective tax rate <Value>{pct(levers.effectiveTaxRatePct)}%</Value> {taxSource}
            </>
          ) : (
            // The rate is 0 and cannot be moved; printing "0%" would read as a
            // measurement.
            <>
              Effective tax rate <Source>not applicable — no income in your Financial Profile</Source>
            </>
          )}
        </p>
        <p>
          <Value>{formatUsd(afterTaxIncome(inputs, levers))}</Value> <Source>after-tax income</Source>
        </p>
      </Row>

      <Row name="match" term="Employer match">
        {inputs.employerMatch > 0 ? (
          <p>
            <Value>{formatUsd(inputs.employerMatch)}/yr</Value>{" "}
            <Source>from the match and 401(k) contribution targets in your Financial Profile</Source>
          </p>
        ) : (
          // Zero is also what a configured match with no 401(k) or Roth 401(k)
          // target to apply it to comes to, so the copy names both inputs.
          <p>
            <Source>
              None counted — needs an employer match and a 401(k) contribution target in your Financial Profile
            </Source>
          </p>
        )}
      </Row>

      <Row name="savings" term="Savings" adjusted={savingsAdjusted}>
        <p>
          {savingsRate === null ? (
            <Value>No income in your Financial Profile</Value>
          ) : (
            <>
              <Value>{pct(savingsRate, 1)}%</Value> <Source>of after-tax income</Source>
            </>
          )}
          {savingsAdjusted && defaultSavingsRate !== null && (
            <>
              {" "}
              <Adjusted>{`adjusted by you (was ${pct(defaultSavingsRate, 1)}%)`}</Adjusted>
            </>
          )}
        </p>
        <p>
          <Value>{formatUsd(annualContribution(inputs, levers))}/yr</Value>{" "}
          <Source>invested each year: after-tax income − spending + employer match</Source>
        </p>
      </Row>

      <Row name="return" term="Return" adjusted={returnAdjusted}>
        <p>
          <Value>{`${pct(levers.nominalReturnPct)}% nominal`}</Value>,{" "}
          <Value>{`${pct(levers.inflationPct)}% inflation`}</Value>, giving{" "}
          <Value>{`${pct(realReturn(levers) * 100)}% real`}</Value>
        </p>
        <p>
          {returnAdjusted ? (
            <Adjusted>{`adjusted by you (was ${pct(defaults.nominalReturnPct)}% nominal, ${pct(defaults.inflationPct)}% inflation)`}</Adjusted>
          ) : (
            <Source>{`from your Financial Profile (${pct(inputs.profileRealReturnPct)}% real return at ${pct(inputs.profileInflationPct)}% inflation)`}</Source>
          )}
        </p>
      </Row>

      <Row name="withdrawal" term="Safe withdrawal rate" adjusted={withdrawalAdjusted}>
        <p>
          <Value>{pct(levers.safeWithdrawalRatePct)}%</Value>{" "}
          {withdrawalAdjusted ? (
            <Adjusted>{`adjusted by you (profile: ${pct(defaults.safeWithdrawalRatePct)}%)`}</Adjusted>
          ) : (
            <Source>from your Financial Profile</Source>
          )}
        </p>
        <p>
          FI number <Value>{formatUsd(fiNumber(levers))}</Value> <Source>annual spending ÷ withdrawal rate</Source>
        </p>
      </Row>

      <Row name="allocation" term="Allocation" adjusted={allocationAdjusted}>
        <p>
          <Value>{`${pct(levers.stockAllocationPct)}% stocks, ${pct(100 - levers.stockAllocationPct)}% bonds`}</Value>{" "}
          {allocationAdjusted ? (
            <Adjusted>{`adjusted by you (default was ${pct(defaults.stockAllocationPct)}% stocks)`}</Adjusted>
          ) : (
            <Source>default, not read from your accounts</Source>
          )}
        </p>
        <p>
          <Source>{ALLOCATION_HINT}</Source>
        </p>
      </Row>

      <Row name="history" term="History">
        <p>
          {`Shiller, ${history.firstStartYear}–${history.lastStartYear} starts, ${history.windowCount} windows of ${history.horizon} years, recentred to your real return`}
        </p>
        <p>
          <Source>
            Source:{" "}
            <a
              href={MARKET_HISTORY_SOURCE.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              {MARKET_HISTORY_SOURCE.name}
            </a>
            , data through {MARKET_HISTORY_SOURCE.lastMonth}, retrieved {MARKET_HISTORY_SOURCE.retrieved}
          </Source>
        </p>
      </Row>

      <Row name="not-modeled" term="Not modeled">
        <ul className="list-disc space-y-0.5 pl-5">
          <li>Taxes on withdrawals</li>
          <li>Social Security and pensions</li>
          <li>Fund fees</li>
          <li>Contributions rising with raises</li>
          <li>The withdrawal phase (roadmap #6)</li>
        </ul>
      </Row>
    </dl>
  );
}
