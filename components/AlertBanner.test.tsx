import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AlertBanner from "./AlertBanner";

describe("AlertBanner", () => {
  it("renders the warning icon and data-threshold=80 for the 80% threshold", () => {
    render(
      <AlertBanner threshold={80} message="You're at 80% of Groceries." onDismiss={() => {}} />,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-threshold", "80");
    expect(screen.getByText("⚠")).toBeInTheDocument();
    expect(screen.getByText(/80% of Groceries/)).toBeInTheDocument();
  });

  it("renders the strong-warning icon and data-threshold=100 for the 100% threshold", () => {
    render(
      <AlertBanner threshold={100} message="You've blown the Groceries budget." onDismiss={() => {}} />,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-threshold", "100");
    expect(screen.getByText("!")).toBeInTheDocument();
  });

  it("calls onDismiss when the dismiss button is clicked", async () => {
    const onDismiss = vi.fn();
    render(<AlertBanner threshold={80} message="msg" onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole("button", { name: /Dismiss alert/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("dismiss button is keyboard-focusable", async () => {
    render(<AlertBanner threshold={100} message="msg" onDismiss={() => {}} />);
    const btn = screen.getByRole("button", { name: /Dismiss alert/i });
    btn.focus();
    expect(btn).toHaveFocus();
  });
});
