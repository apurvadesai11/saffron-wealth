import type { ReactNode } from "react";

// CSRF cookie is issued by proxy.ts on every request to /login, /register,
// /password-reset (Server Components in Next.js 15+ can't mutate cookies).
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md flex flex-col items-center gap-4">
        {children}
      </div>
    </div>
  );
}
