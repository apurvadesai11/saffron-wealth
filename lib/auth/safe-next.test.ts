import { describe, it, expect } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it("passes through a site-relative path", () => {
    expect(safeNext("/transactions")).toBe("/transactions");
    expect(safeNext("/net-worth")).toBe("/net-worth");
    expect(safeNext("/")).toBe("/");
  });

  it("preserves query and hash on a relative path", () => {
    expect(safeNext("/transactions?type=expense")).toBe("/transactions?type=expense");
    expect(safeNext("/profile#sessions")).toBe("/profile#sessions");
  });

  it("rejects an absolute off-origin URL", () => {
    expect(safeNext("https://evil.com")).toBe("/");
    expect(safeNext("http://evil.com/path")).toBe("/");
  });

  it("rejects a protocol-relative URL", () => {
    expect(safeNext("//evil.com")).toBe("/");
    expect(safeNext("//evil.com/steal")).toBe("/");
  });

  it("rejects a backslash-smuggled protocol-relative URL", () => {
    // Browsers normalize "\" to "/", so these resolve off-origin too.
    expect(safeNext("/\\evil.com")).toBe("/");
    expect(safeNext("\\\\evil.com")).toBe("/");
  });

  it("rejects a value whose slashes are hidden behind stripped whitespace", () => {
    expect(safeNext("/\t/evil.com")).toBe("/");
    expect(safeNext("/\n/evil.com")).toBe("/");
    expect(safeNext("/\r\n/evil.com")).toBe("/");
  });

  it("rejects a javascript: scheme", () => {
    expect(safeNext("javascript:alert(1)")).toBe("/");
    expect(safeNext("JavaScript:alert(1)")).toBe("/");
  });

  it("rejects a data: scheme", () => {
    expect(safeNext("data:text/html,<script>alert(1)</script>")).toBe("/");
  });

  it("rejects a bare relative path with no leading slash", () => {
    // "evil.com" would resolve relative to the current directory, but it is
    // not a value proxy.ts would ever produce, so treat it as untrusted.
    expect(safeNext("evil.com")).toBe("/");
    expect(safeNext("transactions")).toBe("/");
  });

  it("falls back to / for empty and missing values", () => {
    expect(safeNext(null)).toBe("/");
    expect(safeNext(undefined)).toBe("/");
    expect(safeNext("")).toBe("/");
  });
});
