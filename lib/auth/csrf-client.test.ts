// Ten lines, but not trivial: this is the client half of the double-submit
// CSRF pattern, and it is the one cookie in the app deliberately readable by
// JavaScript. A regex that fails to match means every mutating request sends
// an empty token and gets a 403 — a total outage of every write, from a bug
// in a one-line regex.
import { describe, it, expect, afterEach, vi } from "vitest";
import { readCsrfCookie } from "./csrf-client";
import { CSRF_COOKIE_NAME } from "./csrf-shared";

function setCookieJar(value: string) {
  Object.defineProperty(document, "cookie", {
    value,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  setCookieJar("");
  vi.unstubAllGlobals();
});

describe("readCsrfCookie", () => {
  it("reads the token when it is the only cookie", () => {
    setCookieJar(`${CSRF_COOKIE_NAME}=abc123`);
    expect(readCsrfCookie()).toBe("abc123");
  });

  it("reads it from the front of a longer jar", () => {
    setCookieJar(`${CSRF_COOKIE_NAME}=abc123; other=x; third=y`);
    expect(readCsrfCookie()).toBe("abc123");
  });

  it("reads it from the middle and the end", () => {
    setCookieJar(`other=x; ${CSRF_COOKIE_NAME}=abc123; third=y`);
    expect(readCsrfCookie()).toBe("abc123");

    setCookieJar(`other=x; third=y; ${CSRF_COOKIE_NAME}=abc123`);
    expect(readCsrfCookie()).toBe("abc123");
  });

  // The anchoring that makes the regex correct: a cookie whose name merely
  // ends with ours must not be mistaken for it, or the app would send some
  // other cookie's value as the CSRF token.
  it("does not match a cookie whose name only ends with the token name", () => {
    setCookieJar(`not_${CSRF_COOKIE_NAME}=wrong-value`);
    expect(readCsrfCookie()).toBeNull();
  });

  it("does not match a cookie whose name starts with the token name", () => {
    setCookieJar(`${CSRF_COOKIE_NAME}_other=wrong-value`);
    expect(readCsrfCookie()).toBeNull();
  });

  it("returns null when the cookie is absent", () => {
    setCookieJar("other=x; third=y");
    expect(readCsrfCookie()).toBeNull();
  });

  it("returns null for an empty jar", () => {
    setCookieJar("");
    expect(readCsrfCookie()).toBeNull();
  });

  it("stops at the delimiter rather than swallowing the rest of the jar", () => {
    setCookieJar(`${CSRF_COOKIE_NAME}=abc123; next=should-not-appear`);
    expect(readCsrfCookie()).not.toContain("should-not-appear");
  });

  // Imported by client components that also render on the server, where there
  // is no document at all.
  it("returns null rather than throwing when there is no document", () => {
    const original = globalThis.document;
    // @ts-expect-error — deliberately simulating the server environment.
    delete globalThis.document;
    try {
      expect(readCsrfCookie()).toBeNull();
    } finally {
      globalThis.document = original;
    }
  });
});
