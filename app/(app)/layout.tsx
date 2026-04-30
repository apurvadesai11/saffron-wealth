import type { ReactNode } from "react";
import Sidebar from "@/components/Sidebar";
import TopHeader from "@/components/TopHeader";

export default function AppShellLayout({ children }: { children: ReactNode }) {
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
