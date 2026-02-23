"use client";

import { ReactNode } from "react";
import { AppProvider } from "@/lib/app-context";

export default function Providers({ children }: { children: ReactNode }) {
  return <AppProvider>{children}</AppProvider>;
}
