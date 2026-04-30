"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

interface Props {
  href: string;
  label: string;
  icon: ReactNode;
}

export default function SidebarNavItem({ href, label, icon }: Props) {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/" && pathname.startsWith(href));

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors mx-2 ${
        active
          ? "bg-gray-100 text-gray-900"
          : "text-gray-500 hover:bg-gray-50 hover:text-gray-800"
      }`}
    >
      {icon}
      <span className="hidden sm:inline text-sm font-medium">{label}</span>
    </Link>
  );
}
