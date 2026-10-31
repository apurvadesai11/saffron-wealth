"use client";

import { useEffect, useRef, useState } from "react";
import type { Category } from "@/lib/types";

interface Props {
  id: string;
  categories: Category[];
  selectedIds: string[];
  onChange: (selectedIds: string[]) => void;
}

// A dropdown rather than a row of chips: a Monarch import brings in dozens of
// categories, and the chips wrapped into a wall the filter card had to grow
// around. Selection order is kept as the user made it.
export default function CategoryMultiSelect({ id, categories, selectedIds, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const summary =
    selectedIds.length === 0
      ? "All categories"
      : selectedIds.length === 1
        ? categories.find(c => c.id === selectedIds[0])?.name ?? "1 category"
        : `${selectedIds.length} categories`;

  const needle = query.trim().toLowerCase();
  const visible = needle
    ? categories.filter(c => c.name.toLowerCase().includes(needle))
    : categories;

  function close() {
    setOpen(false);
    setQuery("");
  }

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();

    // Each opening starts with an empty search, so closing clears it.
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
      setQuery("");
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpen(false);
      setQuery("");
      triggerRef.current?.focus();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle(categoryId: string) {
    onChange(
      selectedIds.includes(categoryId)
        ? selectedIds.filter(c => c !== categoryId)
        : [...selectedIds, categoryId],
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        id={id}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Categories: ${summary}`}
        className="w-full flex items-center justify-between border border-line rounded-lg px-3 py-2 text-sm text-fg text-left focus:outline-none focus:ring-2 focus:ring-accent-ring"
      >
        <span className="truncate">{summary}</span>
        <span aria-hidden="true" className="ml-2 text-fg-muted">▾</span>
      </button>

      {open && (
        // Anchored to the button's right edge: it sits in the filter card's
        // last column, and min-w-56 is wider than that column.
        <div className="absolute right-0 z-30 mt-1 w-full min-w-56 bg-surface border border-line rounded-lg shadow-lg">
          <div className="p-2 border-b border-line-subtle">
            <input
              ref={searchRef}
              type="search"
              aria-label="Search categories"
              placeholder="Search categories…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="w-full border border-line rounded-md px-2.5 py-1.5 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-accent-ring"
            />
          </div>
          {visible.length === 0 ? (
            <p className="px-3 py-3 text-sm text-fg-faint">No categories match.</p>
          ) : (
            <ul className="max-h-64 overflow-y-auto py-1">
              {visible.map(cat => (
                <li key={cat.id}>
                  <label className="flex items-center gap-2 px-3 py-1.5 text-sm text-fg-secondary cursor-pointer hover:bg-surface-sunken">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(cat.id)}
                      onChange={() => toggle(cat.id)}
                      className="rounded border-line"
                    />
                    <span aria-hidden="true" className={`w-2 h-2 rounded-full ${cat.color}`} />
                    {cat.name}
                  </label>
                </li>
              ))}
            </ul>
          )}
          {selectedIds.length > 0 && (
            <div className="px-3 py-2 border-t border-line-subtle text-right">
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-xs font-medium text-accent hover:text-accent-strong transition-colors"
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
