import { describe, it, expect, vi } from "vitest";
import { validateCsrfFromRequest, CSRF_HEADER_NAME, CSRF_COOKIE_NAME } from "./csrf";

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: () => undefined,
      set: () => undefined,
    }),
}));

interface MockReq {
  headers: { get: (name: string) => string | null };
  cookies: { get: (name: string) => { value: string } | undefined };
}

function makeReq(opts: {
  headerToken?: string;
  cookieToken?: string;
}): MockReq {
  return {
    headers: {
      get: (name: string) => {
        if (name.toLowerCase() === CSRF_HEADER_NAME) return opts.headerToken ?? null;
        return null;
      },
    },
    cookies: {
      get: (name: string) => {
        if (name === CSRF_COOKIE_NAME && opts.cookieToken !== undefined) {
          return { value: opts.cookieToken };
        }
        return undefined;
      },
    },
  };
}

describe("validateCsrfFromRequest", () => {
  it("rejects when header is missing", () => {
    const req = makeReq({ cookieToken: "abc123" });
    expect(validateCsrfFromRequest(req as never)).toBe(false);
  });

  it("rejects when cookie is missing", () => {
    const req = makeReq({ headerToken: "abc123" });
    expect(validateCsrfFromRequest(req as never)).toBe(false);
  });

  it("rejects when header and cookie differ", () => {
    const req = makeReq({ headerToken: "abc123def", cookieToken: "xyz789ghi" });
    expect(validateCsrfFromRequest(req as never)).toBe(false);
  });

  it("rejects when lengths differ (length-prefix check before crypto)", () => {
    const req = makeReq({ headerToken: "short", cookieToken: "muchlongertoken" });
    expect(validateCsrfFromRequest(req as never)).toBe(false);
  });

  it("accepts when header equals cookie", () => {
    const token = "0123456789abcdef0123456789abcdef";
    const req = makeReq({ headerToken: token, cookieToken: token });
    expect(validateCsrfFromRequest(req as never)).toBe(true);
  });
});
