#!/usr/bin/env python3
# Reads Robert Shiller's "Irrational Exuberance" spreadsheet (ie_data.xls, from
# https://shillerdata.com/) and regenerates the market-history tables the FIRE
# calculator's historical-sequence simulation runs on:
#
#   lib/market-history-data.ts  annual real total returns (stocks, bonds) and the
#                               source/attribution object; imported by client code
#   lib/cpi-data.ts             monthly CPI from 1970-01; imported by the server
#                               page only, so it stays out of the client bundle
#
# The spreadsheet is never copied into the repo: download it, run this, commit
# the two generated files. Re-run it against a fresh download to refresh them.
#
# Setup (once):  pip3 install --user pandas xlrd
#   Not --break-system-packages (the system pip on this Mac predates it).
# Usage:  python3 -E scripts/build-market-history.py ~/Downloads/ie_data.xls
#   -E ignores PYTHON* environment variables. Don't use -I: it also hides the
#   user site-packages that pandas and xlrd were installed into.
#
# The workbook's header is stacked over several rows (Shiller wraps each label),
# so columns are found by their joined label, never by position. If a label is
# missing or ambiguous the script exits non-zero and prints the labels it found,
# so a relabelled workbook fails loudly instead of silently reading the wrong
# column: a shifted label that landed on a nominal series would produce
# plausible-looking but wrong returns.

import datetime
import numbers
import sys
from pathlib import Path

try:
    import pandas as pd
except ImportError:
    sys.exit("pandas is required: pip3 install --user pandas xlrd")

SOURCE_NAME = "Robert J. Shiller, Irrational Exuberance data"
SOURCE_CITATION = (
    'Robert J. Shiller, "Stock Market Data Used in Irrational Exuberance"\n'
    "// (Princeton University Press, 2000, 2005, 2015, updated)"
)
SOURCE_URL = "https://shillerdata.com/"

SHEET = "Data"
DATE_LABEL = "Date"
CPI_LABEL = "CPI"
# Cumulative indices: stocks is the S&P composite with dividends reinvested,
# bonds is 10-year Treasuries with coupons reinvested, both deflated by CPI.
STOCKS_LABEL = "Real Total Return Price"
BONDS_LABEL = "Real Total Bond Returns"

# The FIRE calculator's inflation scenarios start at 1970; earlier CPI is unused.
CPI_START = (1970, 1)

REPO_ROOT = Path(__file__).resolve().parent.parent
MARKET_OUT = REPO_ROOT / "lib" / "market-history-data.ts"
CPI_OUT = REPO_ROOT / "lib" / "cpi-data.ts"


def fail(message):
    print(message, file=sys.stderr)
    sys.exit(1)


def clean(cell):
    """A header cell as single-spaced text; blank cells come back empty."""
    if pd.isna(cell):
        return ""
    return " ".join(str(cell).split())


def find_header_bottom(raw):
    """Index of the header's bottom row: the one whose first cell is `Date`."""
    for i in range(min(len(raw), 30)):
        if clean(raw.iat[i, 0]) == DATE_LABEL:
            return i
    fail(f"No header row with {DATE_LABEL!r} in column 0 of the first 30 rows of sheet {SHEET!r}.")


def stacked_labels(raw, bottom):
    """Each column's label: its non-empty header cells, top to bottom, joined by spaces."""
    labels = []
    for col in range(raw.shape[1]):
        # Column 0's top rows hold the workbook title and author, not label
        # parts, so the date column is labelled by its bottom cell alone.
        rows = [bottom] if col == 0 else range(bottom + 1)
        labels.append(" ".join(filter(None, (clean(raw.iat[r, col]) for r in rows))))
    return labels


def find_column(matches, what, labels):
    if len(matches) != 1:
        found = "\n".join(f"  [{i}] {label}" for i, label in enumerate(labels))
        fail(f"Expected exactly one column for {what}, found {len(matches)}. Labels found:\n{found}")
    return matches[0]


def number_or_none(cell):
    if isinstance(cell, bool) or not isinstance(cell, numbers.Real) or pd.isna(cell):
        return None
    return float(cell)


def read_rows(raw, bottom, date_col, cpi_col, stocks_col, bonds_col):
    """Data rows as dicts, skipping rows whose date isn't a number (the footnote)."""
    rows = []
    previous = None
    for r in range(bottom + 1, len(raw)):
        date = number_or_none(raw.iat[r, date_col])
        if date is None:
            continue
        year = int(date)
        # Shiller writes 1871.1 for October, so the month is the two decimals.
        month = round((date - year) * 100)
        if not 1 <= month <= 12:
            fail(f"Row {r}: date {date!r} has no valid month.")
        # Consecutive months make every Jan-to-Jan span below exactly 12 months.
        if previous is not None and year * 12 + month != previous + 1:
            fail(f"Row {r}: date {date!r} does not follow the previous month.")
        previous = year * 12 + month
        rows.append(
            {
                "year": year,
                "month": month,
                "cpi": number_or_none(raw.iat[r, cpi_col]),
                "stocks": number_or_none(raw.iat[r, stocks_col]),
                "bonds": number_or_none(raw.iat[r, bonds_col]),
            }
        )
    if not rows:
        fail("No data rows found below the header.")
    return rows


def annual_returns(rows):
    """Calendar-year real total returns as fractions: Jan(y+1) / Jan(y) - 1."""
    januaries = {}
    for row in rows:
        if row["month"] != 1:
            continue
        for key in ("stocks", "bonds"):
            if row[key] is None or row[key] <= 0:
                fail(f"January {row['year']} has no positive {key} index: {row[key]!r}.")
        januaries[row["year"]] = row
    returns = []
    for year in sorted(januaries):
        if year + 1 not in januaries:
            continue
        this_jan, next_jan = januaries[year], januaries[year + 1]
        returns.append(
            {
                "year": year,
                # + 0.0 turns a rounded -0.0 into 0.0
                "stocks": round(next_jan["stocks"] / this_jan["stocks"] - 1, 6) + 0.0,
                "bonds": round(next_jan["bonds"] / this_jan["bonds"] - 1, 6) + 0.0,
            }
        )
    if not returns:
        fail("No year has both its January and the next one.")
    return returns


def monthly_cpi(rows):
    """CPI from CPI_START to the last row that has one (the latest is preliminary)."""
    with_cpi = [r for r in rows if r["cpi"] is not None]
    if not with_cpi:
        fail("No CPI values found.")
    last = with_cpi[-1]
    series = [
        r
        for r in rows
        if CPI_START <= (r["year"], r["month"]) <= (last["year"], last["month"])
    ]
    if (series[0]["year"], series[0]["month"]) != CPI_START:
        fail(f"CPI series does not start at {CPI_START[0]}-{CPI_START[1]:02d}.")
    for r in series:
        if r["cpi"] is None or r["cpi"] <= 0:
            fail(f"CPI for {r['year']}-{r['month']:02d} is missing or not positive: {r['cpi']!r}.")
    return series


def header_comment(retrieved, last_month):
    return f"""// Generated by scripts/build-market-history.py; do not edit by hand.
// Re-run the script against a fresh download of the spreadsheet to refresh it.
//
// Source: {SOURCE_CITATION}, {SOURCE_URL}
// Retrieved {retrieved}. The data runs through {last_month}; its latest month is
// preliminary, because Shiller estimates the most recent CPI."""


def render_market_history(returns, retrieved, last_month):
    entries = "\n".join(
        f"  {{ year: {r['year']}, stocks: {r['stocks']:.6f}, bonds: {r['bonds']:.6f} }},"
        for r in returns
    )
    return f"""{header_comment(retrieved, last_month)}
//
// Each row is one calendar year's real (inflation-adjusted) total return, as a
// fraction: the change in Shiller's January index value to the next January's.
// Stocks are the S&P composite with dividends reinvested; bonds are 10-year
// Treasuries with coupons reinvested. Shiller's monthly prices are averages of
// the month's daily closes, so these are average-to-average, not point-to-point.
import type {{ AnnualRealReturn }} from "./types";

export const MARKET_HISTORY_SOURCE = {{
  name: "{SOURCE_NAME}",
  url: "{SOURCE_URL}",
  retrieved: "{retrieved}",
  lastMonth: "{last_month}",
}};

export const ANNUAL_REAL_RETURNS: AnnualRealReturn[] = [
{entries}
];
"""


def render_cpi(series, retrieved, last_month):
    entries = "\n".join(
        f'  {{ month: "{r["year"]}-{r["month"]:02d}", cpi: {r["cpi"]:.3f} }},' for r in series
    )
    return f"""{header_comment(retrieved, last_month)}
//
// Monthly CPI index levels (not rates) from {CPI_START[0]}-{CPI_START[1]:02d}. Import this only from
// server code, so its several hundred rows stay out of the client bundle; the
// annual table the client needs is in market-history-data.ts.
import type {{ MonthlyCpi }} from "./types";

export const MONTHLY_CPI: MonthlyCpi[] = [
{entries}
];
"""


def main():
    if len(sys.argv) != 2:
        fail("Usage: python3 -E scripts/build-market-history.py <path-to-ie_data.xls>")
    xls_path = Path(sys.argv[1]).expanduser()
    if not xls_path.is_file():
        fail(f"Spreadsheet not found: {xls_path}")

    print(f"Reading sheet {SHEET!r} from {xls_path} ...")
    try:
        raw = pd.read_excel(xls_path, sheet_name=SHEET, header=None)
    except (ValueError, ImportError) as err:
        fail(f"Could not read sheet {SHEET!r} (is xlrd installed?): {err}")

    bottom = find_header_bottom(raw)
    labels = stacked_labels(raw, bottom)
    bottoms = [clean(raw.iat[bottom, col]) for col in range(raw.shape[1])]
    date_col = find_column([i for i, b in enumerate(bottoms) if b == DATE_LABEL], DATE_LABEL, labels)
    cpi_col = find_column([i for i, b in enumerate(bottoms) if b == CPI_LABEL], CPI_LABEL, labels)
    stocks_col = find_column([i for i, l in enumerate(labels) if l == STOCKS_LABEL], STOCKS_LABEL, labels)
    bonds_col = find_column([i for i, l in enumerate(labels) if l == BONDS_LABEL], BONDS_LABEL, labels)
    print(
        f"Columns: date [{date_col}], CPI [{cpi_col}] {labels[cpi_col]!r}, "
        f"stocks [{stocks_col}] {labels[stocks_col]!r}, bonds [{bonds_col}] {labels[bonds_col]!r}"
    )

    rows = read_rows(raw, bottom, date_col, cpi_col, stocks_col, bonds_col)
    returns = annual_returns(rows)
    series = monthly_cpi(rows)

    # The CPI's last month is the data's last month; the source object names it.
    last_month = f"{series[-1]['year']}-{series[-1]['month']:02d}"
    # The file's modification date is when it was downloaded, and unlike today's
    # date it doesn't change when the same file is processed again.
    retrieved = datetime.date.fromtimestamp(xls_path.stat().st_mtime).isoformat()

    MARKET_OUT.write_text(render_market_history(returns, retrieved, last_month), encoding="utf-8")
    CPI_OUT.write_text(render_cpi(series, retrieved, last_month), encoding="utf-8")
    print(f"Wrote {len(returns)} annual returns ({returns[0]['year']}-{returns[-1]['year']}) to {MARKET_OUT}")
    print(f"Wrote {len(series)} monthly CPI values (through {last_month}) to {CPI_OUT}")


if __name__ == "__main__":
    main()
