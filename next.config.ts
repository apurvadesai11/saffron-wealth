import type { NextConfig } from "next";
import { STATIC_SECURITY_HEADERS, buildApiCsp } from "./lib/security-headers";

// The CSP for HTML lives in proxy.ts, not here: it carries a per-request nonce
// that Next propagates to its inline bootstrap scripts, which a static header
// cannot express. Everything that does not vary per request is set here.
const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Pages and API alike. A JSON response renders nothing but can still
        // be framed or content-type sniffed.
        source: "/:path*",
        headers: STATIC_SECURITY_HEADERS,
      },
      {
        // API routes get their CSP here because several (/api/auth/*,
        // /api/cron/*) are deliberately outside the proxy's matcher.
        source: "/api/:path*",
        headers: [{ key: "Content-Security-Policy", value: buildApiCsp() }],
      },
    ];
  },
};

export default nextConfig;
