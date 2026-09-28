import type { ReactNode } from "react";

// CSRF cookie is issued by proxy.ts on every request to /login, /register,
// /password-reset (Server Components in Next.js 15+ can't mutate cookies).

// The CSP carries a per-request nonce (see lib/security-headers.ts), and Next
// can only stamp it onto its inline scripts while rendering the request. A
// prerendered page has no nonce to stamp, so /login, /register and
// /password-reset shipped HTML whose scripts the enforcing CSP then blocked —
// the login page simply would not hydrate in production. Dev never showed it,
// because dev renders everything on demand.
//
// These pages are three small client components behind middleware that
// already runs per request, so giving up their prerender costs little.
export const dynamic = "force-dynamic";
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md flex flex-col items-center gap-4">
        {children}
      </div>
    </div>
  );
}
