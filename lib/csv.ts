// Thin papaparse wrapper + header validation for the Monarch CSV imports
// (Phase 2b transaction import, Phase 3 balance-history import). papaparse is
// a deliberate exception to this app's no-dependency house style — real
// Monarch exports contain quoted fields with embedded commas (an account
// literally named `Mortgage, Lakeside Home`) that a hand-rolled `split(',')`
// would corrupt.

import Papa from "papaparse";

const BOM = "\uFEFF";

export class CsvHeaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvHeaderError";
  }
}

export function parseCsv<T>(text: string): { rows: Record<string, string>[]; header: string[] } {
  // Some spreadsheet tools save "UTF-8 with BOM" (utf-8-sig). Left alone, the
  // BOM fuses onto the first header cell (e.g. the literal text "Date"
  // prefixed with U+FEFF) and every downstream header comparison against
  // "Date" silently fails.
  const withoutBom = text.startsWith(BOM) ? text.slice(BOM.length) : text;

  const result = Papa.parse<Record<string, string>>(withoutBom, {
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
