// All four modals had role="dialog", aria-modal, aria-labelledby, Escape to
// close and autofocus — but none confined Tab to the dialog or gave focus back
// to whatever opened it. A keyboard user tabbed straight out of the dialog into
// the page behind the overlay, where they could operate controls the overlay
// visually covers.
import { describe, it, expect, vi } from "vitest";
import { useRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useFocusTrap } from "./use-focus-trap";

function Dialog({ onClose = vi.fn() }: { onClose?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref);
  return (
    <div ref={ref} role="dialog" aria-modal="true">
      <button>first</button>
      <input aria-label="middle" />
      <button>last</button>
    </div>
  );
}

function Harness({ open }: { open: boolean }) {
  return (
    <>
      <button>trigger</button>
      <button>behind the overlay</button>
      {open && <Dialog />}
    </>
  );
}

describe("useFocusTrap", () => {
  it("moves focus into the dialog when it opens", () => {
    render(<Harness open />);
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
  });

  it("wraps Tab from the last focusable back to the first", async () => {
    render(<Harness open />);
    screen.getByText("last").focus();

    await userEvent.tab();

    expect(document.activeElement).toBe(screen.getByText("first"));
  });

  it("wraps Shift+Tab from the first focusable back to the last", async () => {
    render(<Harness open />);
    screen.getByText("first").focus();

    await userEvent.tab({ shift: true });

    expect(document.activeElement).toBe(screen.getByText("last"));
  });

  // The containment property stated as the acceptance criterion: however many
  // times you tab, you are still inside.
  it("keeps focus inside the dialog across a full cycle and beyond", async () => {
    render(<Harness open />);
    screen.getByText("first").focus();

    for (let i = 0; i < 7; i++) {
      await userEvent.tab();
      expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    }
  });

  it("returns focus to whatever was focused when it opened", async () => {
    const { rerender } = render(<Harness open={false} />);
    const trigger = screen.getByText("trigger");
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    rerender(<Harness open />);
    expect(document.activeElement).not.toBe(trigger);

    rerender(<Harness open={false} />);
    expect(document.activeElement).toBe(trigger);
  });

  // A dialog with nothing focusable must not throw or spin.
  it("tolerates a dialog with no focusable children", async () => {
    function Empty() {
      const ref = useRef<HTMLDivElement>(null);
      useFocusTrap(ref);
      return <div ref={ref} role="dialog">nothing here</div>;
    }
    render(<Empty />);

    await userEvent.tab();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  // Disabled and hidden controls are not tab stops, so the wrap has to skip
  // them or Tab lands on something the user cannot use.
  it("skips disabled controls when wrapping", async () => {
    function WithDisabled() {
      const ref = useRef<HTMLDivElement>(null);
      useFocusTrap(ref);
      return (
        <div ref={ref} role="dialog">
          <button>first</button>
          <button disabled>disabled</button>
          <button>last</button>
        </div>
      );
    }
    render(<WithDisabled />);
    screen.getByText("last").focus();

    await userEvent.tab();

    expect(document.activeElement).toBe(screen.getByText("first"));
  });
});
