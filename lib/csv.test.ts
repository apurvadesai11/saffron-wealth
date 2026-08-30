import { describe, it, expect } from "vitest";
import { parseCsv, validateHeader, CsvHeaderError } from "./csv";

const REQUIRED_TRANSACTION_COLUMNS = ["Date", "Amount", "Account", "Category"];

describe("parseCsv", () => {
  it("parses a quoted field containing a comma as a single value", () => {
    const csv = 'Date,Account,Amount\n2026-01-01,"Mortgage, Lakeside Home",100\n';
    const { rows } = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].Account).toBe("Mortgage, Lakeside Home");
  });

  it("parses a quoted field containing an escaped quote", () => {
    const csv = 'Date,Notes,Amount\n2026-01-01,"She said ""hello""",100\n';
    const { rows } = parseCsv(csv);
    expect(rows[0].Notes).toBe('She said "hello"');
  });

  it("parses an embedded newline inside a quoted field", () => {
    const csv = 'Date,Notes,Amount\n2026-01-01,"Line one\nLine two",100\n';
    const { rows } = parseCsv(csv);
    expect(rows[0].Notes).toBe("Line one\nLine two");
  });

  it("strips a leading BOM so the first header cell still matches", () => {
    const csv = "\uFEFFDate,Amount\n2026-01-01,100\n";
    const { header, rows } = parseCsv(csv);
    expect(header[0]).toBe("Date");
    expect(rows[0].Date).toBe("2026-01-01");
  });

  it("skipEmptyLines: a trailing blank line produces no row", () => {
    const csv = "Date,Amount\n2026-01-01,100\n\n";
    const { rows } = parseCsv(csv);
    expect(rows).toHaveLength(1);
  });
});

describe("validateHeader", () => {
  it("validates the real 11-column transaction header against the 4 required columns", () => {
    const header = [
      "Date",
      "Merchant",
      "Category",
      "Account",
      "Original Statement",
      "Notes",
      "Amount",
      "Tags",
      "Owner",
      "Reviewed",
      "Id",
    ];
    expect(() => validateHeader(header, REQUIRED_TRANSACTION_COLUMNS)).not.toThrow();
  });

  it("validates a legacy 8-column header with no Owner/Reviewed/Id", () => {
    const header = [
      "Date",
      "Merchant",
      "Category",
      "Account",
      "Original Statement",
      "Notes",
      "Amount",
      "Tags",
    ];
    expect(() => validateHeader(header, REQUIRED_TRANSACTION_COLUMNS)).not.toThrow();
  });

  it("throws CsvHeaderError naming the missing column and the actual header when Amount is missing", () => {
    const header = ["Date", "Account", "Category"];
    let caught: unknown;
    try {
      validateHeader(header, REQUIRED_TRANSACTION_COLUMNS);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CsvHeaderError);
    const message = (caught as CsvHeaderError).message;
    expect(message).toContain("Amount");
    expect(message).toContain(header.join(", "));
  });

  it("is case-insensitive and whitespace-trimmed", () => {
    const header = [" date ", "AMOUNT", "account", "Category"];
    expect(() => validateHeader(header, REQUIRED_TRANSACTION_COLUMNS)).not.toThrow();
  });
});
