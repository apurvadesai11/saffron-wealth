"use client";

import { useSyncExternalStore } from "react";
import {
  THEME_PREFERENCES,
  readThemeCookie,
  serializeThemeCookie,
  themeAttribute,
  type ThemePreference,
} from "@/lib/theme";

const LABELS: Record<ThemePreference, string> = {
  light: "Light",
  system: "System",
  dark: "Dark",
};

// The cookie is the store. Listeners only cover this tab: another open tab
// picks the change up on its next load.
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function applyTheme(pref: ThemePreference) {
  const attr = themeAttribute(pref);
  const root = document.documentElement;
  if (attr) root.dataset.theme = attr;
  else delete root.dataset.theme;
  document.cookie = serializeThemeCookie(pref, location.protocol === "https:");
  listeners.forEach((l) => l());
}

export default function ThemeSelector() {
  // Null on the server: the selection is only known once the cookie can be
  // read, so nothing is shown as selected until hydration rather than the
  // wrong option.
  const current = useSyncExternalStore(
    subscribe,
    () => readThemeCookie(document.cookie),
    () => null,
  );

  return (
    <div role="radiogroup" aria-label="Theme" className="inline-flex gap-1 rounded-lg bg-surface-muted p-1">
      {THEME_PREFERENCES.map((pref) => {
        const selected = current === pref;
        return (
          <button
            key={pref}
            type="button"
            role="radio"
            aria-checked={selected}
            data-state={selected ? "selected" : "idle"}
            onClick={() => applyTheme(pref)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              selected ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg-secondary"
            }`}
          >
            {LABELS[pref]}
          </button>
        );
      })}
    </div>
  );
}
