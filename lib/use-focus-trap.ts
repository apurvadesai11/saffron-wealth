"use client";

import { useEffect, type RefObject } from "react";

// Everything the browser treats as a tab stop, minus the things it doesn't:
// `[tabindex="-1"]` is focusable programmatically but is not a tab stop, and a
// disabled control is neither. Checked against the live DOM on every Tab
// rather than captured once, because a dialog's focusable set changes as the
// user works — the import modals swap their whole footer between the upload,
// preview and result steps.
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    // offsetParent is null for a `display: none` subtree, which is the cheap
    // way to skip controls that are in the DOM but not on screen.
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

/**
 * Confine Tab to `ref`'s subtree, and give focus back when it unmounts.
 *
 * All four modals already had role="dialog", aria-modal, aria-labelledby,
 * Escape-to-close and autofocus. None of them stopped Tab from leaving, so a
 * keyboard user tabbed out of the dialog into the page behind the overlay and
 * could operate controls the overlay visually covers. aria-modal tells a
 * screen reader the rest of the page is inert; it does not make it so.
 *
 * Written once and applied to all four rather than per modal, so the four
 * cannot drift apart on the one behavior a keyboard user notices.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    // Captured before we move focus, and restored on unmount — this is the
    // element the user was on when they opened the dialog, which is where
    // they expect to be when it closes.
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Only take focus if the dialog doesn't already have it: several of these
    // modals autofocus a specific field on mount, and that choice should win.
    if (!container.contains(document.activeElement)) {
      focusableWithin(container)[0]?.focus();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const focusable = focusableWithin(container!);
      if (focusable.length === 0) {
        // Nothing to move to; keep focus where it is rather than letting the
        // browser walk out of the dialog.
        e.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      // Focus starting outside the dialog (a stray programmatic focus, or the
      // container itself) is pulled back to an end rather than left to the
      // browser's document order.
      if (!container!.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }

      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // isConnected: if the trigger itself was removed while the dialog was
      // open, focusing it would throw focus to <body> anyway — leave it alone
      // and let the browser decide.
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [ref]);
}
