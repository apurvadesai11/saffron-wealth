import { useState } from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import IncomeStreamsEditor, { newIncomeDraft, type IncomeDraft } from "./IncomeStreamsEditor";

function Harness({
  initial = [],
  errors = {},
}: {
  initial?: IncomeDraft[];
  errors?: Record<string, string>;
}) {
  const [rows, setRows] = useState(initial);
  return <IncomeStreamsEditor rows={rows} errors={errors} onChange={setRows} />;
}

describe("IncomeStreamsEditor", () => {
  it("adds a salary row paid every two weeks", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "+ Add income" }));
    expect(screen.getByLabelText("Income 1 type")).toHaveValue("salary");
    expect(screen.getByLabelText("Income 1 frequency")).toHaveValue("biweekly");
  });

  it("moves an untouched default frequency along with the kind", async () => {
    render(<Harness initial={[newIncomeDraft()]} />);
    await userEvent.selectOptions(screen.getByLabelText("Income 1 type"), "bonus");
    expect(screen.getByLabelText("Income 1 frequency")).toHaveValue("annual");
  });

  it("keeps a frequency the user picked when the kind changes", async () => {
    render(<Harness initial={[newIncomeDraft()]} />);
    await userEvent.selectOptions(screen.getByLabelText("Income 1 frequency"), "semimonthly");
    await userEvent.selectOptions(screen.getByLabelText("Income 1 type"), "bonus");
    expect(screen.getByLabelText("Income 1 frequency")).toHaveValue("semimonthly");
  });

  it("removes a row", async () => {
    render(<Harness initial={[newIncomeDraft(), newIncomeDraft("rental")]} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove income 1" }));
    expect(screen.getByLabelText("Income 1 type")).toHaveValue("rental");
    expect(screen.queryByLabelText("Income 2 type")).not.toBeInTheDocument();
  });

  it("totals the rows whose amounts parse, commas allowed", async () => {
    render(<Harness initial={[newIncomeDraft(), newIncomeDraft("rsu"), newIncomeDraft("bonus")]} />);
    await userEvent.type(screen.getByLabelText("Income 1 annual amount"), "90,000");
    await userEvent.type(screen.getByLabelText("Income 2 annual amount"), "20000.50");
    await userEvent.type(screen.getByLabelText("Income 3 annual amount"), "lots");
    expect(screen.getByTestId("income-total")).toHaveTextContent("$110,000.50");
  });

  it("shows $0.00 with no rows", () => {
    render(<Harness />);
    expect(screen.getByTestId("income-total")).toHaveTextContent("$0.00");
  });

  it("renders a row's field error under that row", () => {
    render(
      <Harness
        initial={[newIncomeDraft(), newIncomeDraft()]}
        errors={{ "incomeStreams.1.annualAmount": "Enter an amount above $0." }}
      />,
    );
    expect(screen.getByText("Enter an amount above $0.")).toBeInTheDocument();
    expect(screen.getByLabelText("Income 2 annual amount")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Income 1 annual amount")).not.toHaveAttribute("aria-invalid");
  });
});
