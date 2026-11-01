import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import FireLeverSlider from "./FireLeverSlider";

function renderSlider(overrides: Partial<React.ComponentProps<typeof FireLeverSlider>> = {}) {
  const onChange = vi.fn();
  const utils = render(
    <FireLeverSlider
      id="swr"
      label="Safe withdrawal rate"
      value={4}
      min={2.5}
      max={6}
      step={0.05}
      format={(v) => `${v}%`}
      onChange={onChange}
      modified={false}
      {...overrides}
    />,
  );
  return { onChange, ...utils };
}

describe("FireLeverSlider", () => {
  it("labels the range input", () => {
    renderSlider();
    const input = screen.getByLabelText("Safe withdrawal rate");
    expect(input).toHaveAttribute("type", "range");
    expect(input).toHaveAttribute("min", "2.5");
    expect(input).toHaveAttribute("max", "6");
    expect(input).toHaveAttribute("step", "0.05");
  });

  it("shows the value through the formatter", () => {
    renderSlider({ value: 3.5, format: (v) => `${v.toFixed(2)} percent` });
    expect(screen.getByText("3.50 percent")).toBeInTheDocument();
  });

  it("reports a change as a number", () => {
    const { onChange } = renderSlider();
    fireEvent.change(screen.getByLabelText("Safe withdrawal rate"), { target: { value: "3.5" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(3.5);
  });

  it("marks a modified lever", () => {
    const { container } = renderSlider({ modified: true });
    const marked = container.querySelectorAll("[data-modified]");
    expect(marked).toHaveLength(1);
    expect(marked[0]).toHaveAttribute("data-modified", "true");
    // The wrapper carries it, and it contains the input.
    expect(marked[0]).not.toBe(screen.getByLabelText("Safe withdrawal rate"));
    expect(marked[0]).toContainElement(screen.getByLabelText("Safe withdrawal rate"));
  });

  it("does not mark an untouched lever", () => {
    const { container } = renderSlider({ modified: false });
    const marked = container.querySelectorAll("[data-modified]");
    expect(marked).toHaveLength(1);
    expect(marked[0]).toHaveAttribute("data-modified", "false");
  });

  it("disabled slider shows its hint", () => {
    const { onChange } = renderSlider({ disabled: true, hint: "No income in your Financial Profile" });
    expect(screen.getByLabelText("Safe withdrawal rate")).toBeDisabled();
    expect(screen.getByText("No income in your Financial Profile")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows a hint on an enabled slider too", () => {
    renderSlider({ hint: "Measured from your transactions" });
    expect(screen.getByText("Measured from your transactions")).toBeInTheDocument();
    expect(screen.getByLabelText("Safe withdrawal rate")).toBeEnabled();
  });

  it("renders no hint text when there is none", () => {
    const { container } = renderSlider();
    expect(container.querySelector("[data-slider-hint]")).toBeNull();
  });
});
