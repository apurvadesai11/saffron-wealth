import { describe, it, expect, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import type { FinancialProfile } from "@/lib/types";
import type { ContributionAccountOption } from "./ContributionTargetsEditor";

// The component reads the CSRF cookie and echoes it as a header. happy-dom
// has no cookie set, so stub the reader rather than the document.
vi.mock("@/lib/auth/csrf-client", () => ({
  readCsrfCookie: () => "test-csrf",
}));

import FinancialProfileClient from "./FinancialProfileClient";

const ROTH: ContributionAccountOption = { id: "acct-roth", name: "Example Roth IRA", type: "roth_ira", archived: false, eligible: true };

function profile(overrides: Partial<FinancialProfile> = {}): FinancialProfile {
  return {
    version: 3,
    effectiveAt: "2025-06-15T12:00:00.000Z",
    anchoredAge: 34,
    ageAnchoredAt: "2025-06-15T12:00:00.000Z",
    targetRetirementAge: 50,
    expectedRealReturnPct: 5,
    safeWithdrawalRatePct: 3.5,
    inflationPct: 2.5,
    filingStatus: "single",
    employerMatch: { matchPct: 50, limitPct: 6 },
    incomeStreams: [{ kind: "salary", label: null, annualAmount: 90000, frequency: "biweekly" }],
    contributionTargets: [{ accountId: "acct-roth", annualAmount: 7000 }],
    ...overrides,
  };
}

function mockFetch(response: { ok: boolean; body: unknown } | Error) {
  const spy = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return { ok: response.ok, json: async () => response.body };
  });
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

// happy-dom doesn't always fire form `submit` from a button click; see the
// note in components/TransactionForm.test.tsx.
async function submit() {
  const form = screen.getByRole("button", { name: "Save profile" }).closest("form");
  if (!form) throw new Error("Form not found");
  await act(async () => {
    fireEvent.submit(form);
  });
}

async function fillRequired() {
  await userEvent.type(screen.getByLabelText("Current age"), "34");
  await userEvent.type(screen.getByLabelText("Target retirement age"), "50");
  await userEvent.type(screen.getByLabelText("Expected real return"), "5");
  await userEvent.type(screen.getByLabelText("Safe withdrawal rate"), "3.5");
  await userEvent.type(screen.getByLabelText("Inflation"), "2.5");
}

describe("FinancialProfileClient — before the first save", () => {
  it("says the profile hasn't been saved and leaves the assumptions blank", () => {
    render(<FinancialProfileClient initialProfile={null} initialAge={null} accounts={[ROTH]} />);
    expect(screen.getByText("Not saved yet")).toBeInTheDocument();
    expect(screen.getByLabelText("Expected real return")).toHaveValue("");
    expect(screen.getByLabelText("Safe withdrawal rate")).toHaveValue("");
    expect(screen.getByLabelText("Inflation")).toHaveValue("");
  });

  it("starts with one salary row", () => {
    render(<FinancialProfileClient initialProfile={null} initialAge={null} accounts={[]} />);
    expect(screen.getByLabelText("Income 1 type")).toHaveValue("salary");
  });

  it("shows field errors and does not send when a required field is blank", async () => {
    const spy = mockFetch({ ok: true, body: {} });
    render(<FinancialProfileClient initialProfile={null} initialAge={null} accounts={[]} />);
    await submit();
    expect(screen.getAllByText("Required.").length).toBeGreaterThanOrEqual(5);
    expect(screen.getByLabelText("Current age")).toHaveAttribute("aria-invalid", "true");
    expect(spy).not.toHaveBeenCalled();
  });

  it("sends the parsed profile and reports the new version", async () => {
    const spy = mockFetch({ ok: true, body: { ok: true, data: { profile: profile({ version: 1 }), changed: true } } });
    render(<FinancialProfileClient initialProfile={null} initialAge={null} accounts={[ROTH]} />);
    await fillRequired();
    await userEvent.type(screen.getByLabelText("Income 1 annual amount"), "90,000");
    await submit();

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/financial-profile");
    expect(init.method).toBe("PUT");
    expect((init.headers as Record<string, string>)["x-csrf-token"]).toBe("test-csrf");
    expect(JSON.parse(init.body as string)).toEqual({
      age: 34,
      targetRetirementAge: 50,
      expectedRealReturnPct: 5,
      safeWithdrawalRatePct: 3.5,
      inflationPct: 2.5,
      filingStatus: null,
      employerMatch: null,
      incomeStreams: [{ kind: "salary", label: null, annualAmount: 90000, frequency: "biweekly" }],
      contributionTargets: [],
    });
    expect(await screen.findByText("Saved as version 1.")).toBeInTheDocument();
    expect(screen.getByText(/^Version 1 · saved/)).toBeInTheDocument();
  });

  it("asks for the other half of a half-filled employer match", async () => {
    const spy = mockFetch({ ok: true, body: {} });
    render(<FinancialProfileClient initialProfile={null} initialAge={null} accounts={[]} />);
    await fillRequired();
    await userEvent.type(screen.getByLabelText("Income 1 annual amount"), "90000");
    await userEvent.type(screen.getByLabelText("Employer match (% of your contributions)"), "50");
    await submit();
    expect(screen.getByLabelText("Employer match limit (% of salary)")).toHaveAttribute("aria-invalid", "true");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("FinancialProfileClient — editing a saved profile", () => {
  it("pre-fills every field, with the derived age rather than the stored one", () => {
    render(<FinancialProfileClient initialProfile={profile()} initialAge={35} accounts={[ROTH]} />);
    expect(screen.getByLabelText("Current age")).toHaveValue("35");
    expect(screen.getByLabelText("Target retirement age")).toHaveValue("50");
    expect(screen.getByLabelText("Filing status")).toHaveValue("single");
    expect(screen.getByLabelText("Inflation")).toHaveValue("2.5");
    expect(screen.getByLabelText("Employer match (% of your contributions)")).toHaveValue("50");
    expect(screen.getByLabelText("Income 1 annual amount")).toHaveValue("90000");
    expect(screen.getByLabelText("Contribution 1 account")).toHaveValue("acct-roth");
    expect(screen.getByText(/^Version 3 · saved/)).toBeInTheDocument();
  });

  it("says so when a save changed nothing", async () => {
    mockFetch({ ok: true, body: { ok: true, data: { profile: profile(), changed: false } } });
    render(<FinancialProfileClient initialProfile={profile()} initialAge={35} accounts={[ROTH]} />);
    await submit();
    expect(await screen.findByText("No changes to save.")).toBeInTheDocument();
  });

  it("renders a server field error against the row it names", async () => {
    mockFetch({
      ok: false,
      body: {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Choose one of your accounts.",
          fieldErrors: { "contributionTargets.0.accountId": "Choose one of your accounts." },
        },
      },
    });
    render(<FinancialProfileClient initialProfile={profile()} initialAge={35} accounts={[ROTH]} />);
    await submit();
    expect(screen.getByLabelText("Contribution 1 account")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getAllByText("Choose one of your accounts.").length).toBeGreaterThanOrEqual(1);
  });

  it("reports a network failure", async () => {
    mockFetch(new Error("offline"));
    render(<FinancialProfileClient initialProfile={profile()} initialAge={35} accounts={[ROTH]} />);
    await submit();
    expect(await screen.findByText("Network error.")).toBeInTheDocument();
  });
});

describe("FinancialProfileClient — the age across time", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function sentBody(spy: ReturnType<typeof mockFetch>) {
    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    return JSON.parse(init.body as string);
  }

  // Review finding: a page rendered just before the save's anniversary and
  // saved just after sent the stale pre-filled age, which the server took as
  // a correction and re-anchored a year low.
  it("sends the age as of the save, not as of the render, when the field is untouched", async () => {
    const spy = mockFetch({ ok: true, body: { ok: true, data: { profile: profile(), changed: false } } });
    // Saved at 34 on 2025-06-15; rendered on 2026-06-14, so the field says 34.
    render(<FinancialProfileClient initialProfile={profile()} initialAge={34} accounts={[ROTH]} />);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-16T12:00:00.000Z"));
    await submit();
    expect(sentBody(spy).age).toBe(35);
  });

  it("sends the typed age when the user changes it", async () => {
    const spy = mockFetch({ ok: true, body: { ok: true, data: { profile: profile(), changed: true } } });
    render(<FinancialProfileClient initialProfile={profile()} initialAge={35} accounts={[ROTH]} />);
    await userEvent.clear(screen.getByLabelText("Current age"));
    await userEvent.type(screen.getByLabelText("Current age"), "40");
    await submit();
    expect(sentBody(spy).age).toBe(40);
  });
});

describe("FinancialProfileClient — server render", () => {
  // Review finding: the saved date was formatted during the server render,
  // in the server's time zone, and suppressHydrationWarning kept that text —
  // React does not patch it on hydration.
  it("leaves the saved date out of the server HTML", () => {
    const html = renderToString(
      <FinancialProfileClient initialProfile={profile()} initialAge={35} accounts={[ROTH]} />,
    );
    expect(html).toContain("Version 3");
    expect(html).not.toMatch(/Jun 1[45], 2025/);
  });

  it("shows the saved date once mounted in the browser", () => {
    render(<FinancialProfileClient initialProfile={profile()} initialAge={35} accounts={[ROTH]} />);
    expect(screen.getByText(/^Version 3 · saved Jun 1[45], 2025$/)).toBeInTheDocument();
  });
});
