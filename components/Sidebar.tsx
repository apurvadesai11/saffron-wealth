import Image from "next/image";
import { NAV_ITEMS } from "@/lib/nav-config";
import SidebarNavItem from "./SidebarNavItem";
import AlertsButton from "./AlertsButton";

export default function Sidebar() {
  return (
    <aside className="fixed top-0 left-0 h-screen w-14 sm:w-56 bg-white border-r border-gray-200 z-40 flex flex-col py-4 gap-2">
      {/* 1. Brand mark — saffron.jpg, top-most spot */}
      <div className="flex items-center gap-3 px-3 mb-2 mx-2">
        <Image
          src="/saffron.jpg"
          alt="Saffron Wealth"
          width={32}
          height={32}
          className="rounded-lg shrink-0"
          priority
        />
        <span className="hidden sm:inline text-sm font-semibold text-gray-800 truncate">
          Saffron Wealth
        </span>
      </div>

      {/* 2. Alerts */}
      <AlertsButton />

      <div className="border-t border-gray-100 mx-3 my-1" />

      {/* 3. Nav items (driven by config — add more in lib/nav-config.ts) */}
      <nav className="flex flex-col gap-1">
        {NAV_ITEMS.map(item => (
          <SidebarNavItem
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon}
          />
        ))}
      </nav>
    </aside>
  );
}
