import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import TopHeader from "@/components/TopHeader";
import { getSession } from "@/lib/auth/server";

export default async function AppShellLayout({ children }: { children: ReactNode }) {
  // proxy.ts only shape-checks the session cookie (Edge runtime can't run
  // Prisma). The real DB-backed validation lives here so a forged cookie that
  // happens to match the regex cannot reach any (app) page. Fail closed if the
  // DB is unreachable — never leak a page to someone we can't authenticate.
  let session = null;
  try {
    session = await getSession();
  } catch {
    // swallow — treated as no session below
  }
  if (!session) redirect("/login");

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />
      <div className="ml-14 sm:ml-56 flex flex-col min-h-screen">
        <TopHeader />
        <main className="flex-1 px-4 sm:px-6 py-6">
          <div className="max-w-3xl mx-auto space-y-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
