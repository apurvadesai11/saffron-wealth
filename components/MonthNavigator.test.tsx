import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MonthNavigator from "./MonthNavigator";

describe("MonthNavigator", () => {
  it("renders the current month/year label", () => {
    render(<MonthNavigator month={4} year={2026} onChange={() => {}} />);
    expect(screen.getByText("May 2026")).toBeInTheDocument();
  });

  it("clicking '‹' from January wraps to December of previous year", async () => {
    const onChange = vi.fn();
    render(<MonthNavigator month={0} year={2026} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /Previous month/i }));
    expect(onChange).toHaveBeenCalledWith(11, 2025);
  });

  it("clicking '‹' from any other month decrements the month", async () => {
    const onChange = vi.fn();
    render(<MonthNavigator month={5} year={2026} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /Previous month/i }));
    expect(onChange).toHaveBeenCalledWith(4, 2026);
  });

  it("clicking '›' from December wraps to January of next year", async () => {
    const onChange = vi.fn();
    render(<MonthNavigator month={11} year={2026} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /Next month/i }));
    expect(onChange).toHaveBeenCalledWith(0, 2027);
  });

  it("clicking '›' from any other month increments the month", async () => {
    const onChange = vi.fn();
    render(<MonthNavigator month={5} year={2026} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /Next month/i }));
    expect(onChange).toHaveBeenCalledWith(6, 2026);
  });
});

describe("MonthNavigator Today button", () => {
  // Only Date is faked; user-event schedules on real timers.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 31, 12));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("jumps to the current month from any other", async () => {
    const onChange = vi.fn();
    render(<MonthNavigator month={2} year={2025} onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: "Today" }));

    expect(onChange).toHaveBeenCalledWith(9, 2026);
  });

  it("is disabled while the current month is already showing", () => {
    render(<MonthNavigator month={9} year={2026} onChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Today" })).toBeDisabled();
  });

  it("is enabled for the same month in another year", () => {
    render(<MonthNavigator month={9} year={2025} onChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Today" })).toBeEnabled();
  });
});
