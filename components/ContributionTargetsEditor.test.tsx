import { useState } from "react";
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ContributionTargetsEditor, {
  type ContributionAccountOption,
  type ContributionDraft,
} from "./ContributionTargetsEditor";

const ROTH: ContributionAccountOption = { id: "acct-roth", name: "Example Roth IRA", type: "roth_ira", archived: false, eligible: true };
const HSA: ContributionAccountOption = { id: "acct-hsa", name: "Example HSA", type: "hsa", archived: false, eligible: true };
const OLD: ContributionAccountOption = { id: "acct-old", name: "Old Brokerage", type: "brokerage", archived: true, eligible: true };

function Harness({
  accounts,
  initial = [],
  errors = {},
}: {
  accounts: ContributionAccountOption[];
  initial?: ContributionDraft[];
  errors?: Record<string, string>;
}) {
  const [rows, setRows] = useState(initial);
  return (
    <ContributionTargetsEditor rows={rows} accounts={accounts} errors={errors} onChange={setRows} />
  );
}

function optionLabels(select: HTMLElement) {
  return within(select).getAllByRole("option").map((o) => o.textContent);
}

describe("ContributionTargetsEditor", () => {
  it("points to Net Worth when there is no account to contribute to", () => {
    render(<Harness accounts={[]} />);
    expect(screen.getByText(/Add a cash, investment, or retirement account on/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Net Worth" })).toHaveAttribute("href", "/net-worth");
    expect(screen.queryByRole("button", { name: "+ Add contribution target" })).not.toBeInTheDocument();
  });

  it("adds a row with no account chosen yet", async () => {
    render(<Harness accounts={[ROTH, HSA]} />);
    await userEvent.click(screen.getByRole("button", { name: "+ Add contribution target" }));
    expect(screen.getByLabelText("Contribution 1 account")).toHaveValue("");
  });

  it("labels an archived account", () => {
    render(<Harness accounts={[ROTH, OLD]} initial={[{ key: "a", accountId: "acct-old", annualAmount: "5000" }]} />);
    expect(optionLabels(screen.getByLabelText("Contribution 1 account"))).toContain("Old Brokerage (archived)");
    expect(screen.getByLabelText("Contribution 1 account")).toHaveValue("acct-old");
  });

  it("labels a referenced account that is no longer eligible and offers it to no other row", () => {
    const card: ContributionAccountOption = {
      id: "acct-card", name: "Retyped Card", type: "credit_card", archived: false, eligible: false,
    };
    render(
      <Harness
        accounts={[ROTH, card]}
        initial={[
          { key: "a", accountId: "acct-card", annualAmount: "5000" },
          { key: "b", accountId: "", annualAmount: "" },
        ]}
      />,
    );
    expect(screen.getByLabelText("Contribution 1 account")).toHaveValue("acct-card");
    expect(optionLabels(screen.getByLabelText("Contribution 1 account"))).toContain(
      "Retyped Card (no longer eligible)",
    );
    expect(optionLabels(screen.getByLabelText("Contribution 2 account"))).not.toContain(
      "Retyped Card (no longer eligible)",
    );
  });

  it("disables adding when only ineligible accounts are left", () => {
    const card: ContributionAccountOption = {
      id: "acct-card", name: "Retyped Card", type: "credit_card", archived: false, eligible: false,
    };
    render(
      <Harness
        accounts={[ROTH, card]}
        initial={[{ key: "a", accountId: "acct-roth", annualAmount: "7000" }]}
      />,
    );
    expect(screen.getByRole("button", { name: "+ Add contribution target" })).toBeDisabled();
  });

  it("does not offer an account another row already uses", () => {
    render(
      <Harness
        accounts={[ROTH, HSA]}
        initial={[
          { key: "a", accountId: "acct-roth", annualAmount: "7000" },
          { key: "b", accountId: "", annualAmount: "" },
        ]}
      />,
    );
    const second = optionLabels(screen.getByLabelText("Contribution 2 account"));
    expect(second).toContain("Example HSA");
    expect(second).not.toContain("Example Roth IRA");
    // A row always keeps its own choice.
    expect(optionLabels(screen.getByLabelText("Contribution 1 account"))).toContain("Example Roth IRA");
  });

  it("disables adding once every account has a target", () => {
    render(
      <Harness
        accounts={[ROTH, HSA]}
        initial={[
          { key: "a", accountId: "acct-roth", annualAmount: "7000" },
          { key: "b", accountId: "acct-hsa", annualAmount: "4000" },
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "+ Add contribution target" })).toBeDisabled();
  });

  it("removes a row", async () => {
    render(<Harness accounts={[ROTH]} initial={[{ key: "a", accountId: "acct-roth", annualAmount: "7000" }]} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove contribution 1" }));
    expect(screen.queryByLabelText("Contribution 1 account")).not.toBeInTheDocument();
  });

  it("renders a server error against the row it names", () => {
    render(
      <Harness
        accounts={[ROTH]}
        initial={[{ key: "a", accountId: "acct-roth", annualAmount: "7000" }]}
        errors={{ "contributionTargets.0.accountId": "Choose one of your accounts." }}
      />,
    );
    expect(screen.getByText("Choose one of your accounts.")).toBeInTheDocument();
    expect(screen.getByLabelText("Contribution 1 account")).toHaveAttribute("aria-invalid", "true");
  });
});
