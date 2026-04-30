"use client";

import { useEffect, useRef, useState } from "react";
import { useAlertState } from "@/lib/use-alert-state";
import AlertPanel from "./AlertPanel";

export default function AlertsButton() {
  const { activeAlerts, dismissAlert } = useAlertState();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  return (
    <div ref={containerRef} className="relative mx-2">
      <button
        onClick={() => setOpen(prev => !prev)}
        className={`relative w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
          open ? "bg-gray-100 text-gray-900" : "text-gray-500 hover:bg-gray-50 hover:text-gray-800"
        }`}
        aria-label={`${activeAlerts.length} budget alert${activeAlerts.length === 1 ? "" : "s"}`}
        aria-expanded={open}
      >
        <span className="relative shrink-0">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          {activeAlerts.length > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[1rem] h-4 px-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
              {activeAlerts.length}
            </span>
          )}
        </span>
        <span className="hidden sm:inline text-sm font-medium">Alerts</span>
      </button>

      {open && (
        <div
          className="fixed sm:absolute left-16 sm:left-full top-16 sm:top-0 sm:ml-3 w-80 z-40 bg-white rounded-xl shadow-lg border border-gray-200 p-3"
          role="dialog"
          aria-label="Budget alerts"
        >
          <div className="flex items-center justify-between mb-2 px-1">
            <p className="text-sm font-semibold text-gray-700">Alerts</p>
            <button
              onClick={() => setOpen(false)}
              className="text-gray-300 hover:text-gray-500 transition-colors text-lg leading-none"
              aria-label="Close"
            >×</button>
          </div>
          {activeAlerts.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-3">No active alerts.</p>
          ) : (
            <AlertPanel alerts={activeAlerts} onDismiss={dismissAlert} />
          )}
        </div>
      )}
    </div>
  );
}
