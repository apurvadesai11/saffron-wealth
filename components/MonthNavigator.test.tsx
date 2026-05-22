import { describe, it, expect, vi } from "vitest";
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
