import { describe, it, expect } from "vitest";
import type { NextRequest } from "next/server";
import { clientIp, userAgent } from "./request-info";

// A minimal stand-in: these functions only ever read headers.
function req(headers: Record<string, string>): NextRequest {
  const h = new Headers(headers);
  return { headers: h } as unknown as NextRequest;
}

describe("clientIp — X-Forwarded-For is append-only", () => {
  // The left-most entry is whatever the client claimed; the right-most is what
  // our trusted proxy observed. Reading the left-most made every IP-keyed rate
  // limit bypassable by rotating a header, and every audit-log IP fiction.
  it("takes the right-most entry, not the left-most", () => {
    expect(
      clientIp(req({ "x-forwarded-for": "1.2.3.4, 203.0.113.7" })),
    ).toBe("203.0.113.7");
  });

  it("ignores a spoofed left-most entry entirely", () => {
    // The attacker controls "1.2.3.4"; the proxy appended the real address.
    const spoofed = clientIp(req({ "x-forwarded-for": "1.2.3.4, 198.51.100.9" }));
    expect(spoofed).not.toBe("1.2.3.4");
    expect(spoofed).toBe("198.51.100.9");
  });

  it("cannot be moved by rotating the claimed value", () => {
    // The whole point: the rate-limit key must not change when the client
    // changes its claim.
    const a = clientIp(req({ "x-forwarded-for": "10.0.0.1, 198.51.100.9" }));
    const b = clientIp(req({ "x-forwarded-for": "10.0.0.2, 198.51.100.9" }));
    const c = clientIp(req({ "x-forwarded-for": "evil, 198.51.100.9" }));
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("handles a single-entry chain", () => {
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("handles a multi-hop chain by taking the last entry", () => {
    expect(
      clientIp(
        req({ "x-forwarded-for": "1.2.3.4, 10.0.0.1, 10.0.0.2, 198.51.100.9" }),
      ),
    ).toBe("198.51.100.9");
  });

  it("tolerates inconsistent whitespace", () => {
    expect(
      clientIp(req({ "x-forwarded-for": "1.2.3.4,198.51.100.9" })),
    ).toBe("198.51.100.9");
    expect(
      clientIp(req({ "x-forwarded-for": "  1.2.3.4 ,   198.51.100.9   " })),
    ).toBe("198.51.100.9");
  });

  it("does not return an empty string for a trailing comma", () => {
    // An empty key would be shared by every request that sent one, collapsing
    // those callers into a single rate-limit bucket.
    expect(clientIp(req({ "x-forwarded-for": "198.51.100.9," }))).toBe("198.51.100.9");
    expect(clientIp(req({ "x-forwarded-for": "198.51.100.9, " }))).toBe("198.51.100.9");
  });

  it("falls through when the header is empty or only separators", () => {
    expect(clientIp(req({ "x-forwarded-for": "" }))).toBeNull();
    expect(clientIp(req({ "x-forwarded-for": ",," }))).toBeNull();
    expect(
      clientIp(req({ "x-forwarded-for": ",,", "x-real-ip": "203.0.113.1" })),
    ).toBe("203.0.113.1");
  });
});

describe("clientIp — platform header is preferred", () => {
  it("prefers x-vercel-forwarded-for over x-forwarded-for", () => {
    // Vercel's edge sets and overwrites this one, so it cannot be forged.
    expect(
      clientIp(
        req({
          "x-vercel-forwarded-for": "203.0.113.50",
          "x-forwarded-for": "1.2.3.4, 198.51.100.9",
        }),
      ),
    ).toBe("203.0.113.50");
  });

  it("a spoofed X-Forwarded-For cannot change the key on Vercel", () => {
    const key = (xff: string) =>
      clientIp(
        req({ "x-vercel-forwarded-for": "203.0.113.50", "x-forwarded-for": xff }),
      );
    expect(key("1.2.3.4")).toBe("203.0.113.50");
    expect(key("5.6.7.8, 9.9.9.9")).toBe("203.0.113.50");
  });

  it("takes the right-most entry of the platform header too", () => {
    expect(
      clientIp(req({ "x-vercel-forwarded-for": "1.2.3.4, 203.0.113.50" })),
    ).toBe("203.0.113.50");
  });

  it("falls back to x-forwarded-for when the platform header is empty", () => {
    expect(
      clientIp(
        req({ "x-vercel-forwarded-for": "", "x-forwarded-for": "1.2.3.4, 198.51.100.9" }),
      ),
    ).toBe("198.51.100.9");
  });
});

describe("clientIp — no proxy headers", () => {
  it("returns null in local development", () => {
    // Correct rather than unfortunate: with no proxy there is nothing to
    // trust. Callers pass "unknown" as the rate-limit key and audit rows carry
    // a null ipAddress.
    expect(clientIp(req({}))).toBeNull();
  });

  it("still reads x-real-ip when it is the only header present", () => {
    // Keeps audit-log IPs populated behind a plain NGINX setup.
    expect(clientIp(req({ "x-real-ip": "203.0.113.1" }))).toBe("203.0.113.1");
  });

  it("trims x-real-ip and rejects a blank one", () => {
    expect(clientIp(req({ "x-real-ip": "  203.0.113.1  " }))).toBe("203.0.113.1");
    expect(clientIp(req({ "x-real-ip": "   " }))).toBeNull();
  });
});

describe("userAgent", () => {
  it("returns the header when present", () => {
    expect(userAgent(req({ "user-agent": "Mozilla/5.0" }))).toBe("Mozilla/5.0");
  });

  it("returns null when absent", () => {
    expect(userAgent(req({}))).toBeNull();
  });
});
