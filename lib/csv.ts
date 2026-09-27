// Thin papaparse wrapper + header validation for the Monarch CSV imports
// (Phase 2b transaction import, Phase 3 balance-history import). papaparse is
// a deliberate exception to this app's no-dependency house style — real
// Monarch exports contain quoted fields with embedded commas (an account
// literally named `Mortgage, Lakeside Home`) that a hand-rolled `split(',')`
// would corrupt.

import Papa from "papaparse";

export class CsvHeaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvHeaderError";
  }
}

export function parseCsv(text: string): { rows: Record<string, string>[]; header: string[] } {
  // papaparse strips a leading UTF-8 BOM internally before parsing (its own
  // stripBom()), so a BOM-prefixed export still yields a clean first header
  // cell without us doing anything here — see the BOM-prefixed test in
  // lib/csv.test.ts, which pins that guarantee.
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });

  return {
    rows: result.data,
    header: result.meta.fields ?? [],
  };
}

export function validateHeader(header: string[], required: string[]): void {
  const normalize = (column: string) => column.trim().toLowerCase();
  const found = new Set(header.map(normalize));
  const missing = required.filter((column) => !found.has(normalize(column)));

  if (missing.length > 0) {
    throw new CsvHeaderError(
      `CSV is missing required column(s): ${missing.join(", ")}. Found header: ${header.join(", ")}`,
    );
  }
}
