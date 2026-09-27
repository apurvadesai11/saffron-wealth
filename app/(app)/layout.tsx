import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import TopHeader from "@/components/TopHeader";
import { getSession } from "@/lib/auth/server";
import { AppProvider } from "@/lib/app-context";
import { listCategories } from "@/lib/categories";
import { listTransactions } from "@/lib/transactions";
import { listBudgets } from "@/lib/budgets";

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

  // AppProvider lives here (not the root layout) because only (app) routes
  // read financial data — (auth) pages never call useApp(). Fetched
  // server-side and passed down so the client never re-fetches on first
  // paint; only (app)/net-worth fetches independently, and only because it
  // predates this hydration and isn't on AppProvider (see lib/accounts.ts).
  const [categories, transactions, budgets] = await Promise.all([
    listCategories(session.user.id),
    listTransactions(session.user.id),
    listBudgets(session.user.id),
  ]);

  return (
    <AppProvider
      seedCategories={categories}
      seedTransactions={transactions}
      seedBudgets={budgets}
    >
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
    </AppProvider>
  );
}
