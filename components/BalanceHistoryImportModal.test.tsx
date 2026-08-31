import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BalanceHistoryImportModal from "./BalanceHistoryImportModal";

// Unlike MonarchImportModal, this component doesn't read useApp() or call
// useRouter() itself — NetWorthClient owns the refresh decision via the
// onImported prop (see that component's comment on why: this page has no
// AppProvider seed-sync to lean on). So plain render() is enough here, no
// renderWithApp / next/navigation mock needed.

const PREVIEW_SUMMARY = {
  accountsFound: 3,
  newAccounts: [
    { name: "Everyday Checking", guessedType: "cash", archived: false },
    { name: "Legacy Brokerage", guessedType: "brokerage", archived: true },
  ],
  existingAccounts: 1,
  eventRows: 8,
  newEventRows: 8,
  duplicateEventRows: 0,
  skippedNonAccountRows: 1,
  dateRange: { from: "2026-01-01", to: "2026-01-03" },
};

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

function csvFile(name = "balance-history.csv") {
  return new File(["Date,Balance,Account\n2026-01-01,100,Everyday Checking\n"], name, {
    type: "text/csv",
  });
}

async function pickFile(input: HTMLElement, file: File) {
  await userEvent.upload(input, file);
}

beforeEach(() => {
  // readCsrfCookie() reads document.cookie directly — give it something so
  // the header always has a stable value across tests.
  document.cookie = "sw_csrf=test-csrf-token";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BalanceHistoryImportModal — preview → confirm → success", () => {
  it("previews the file, shows the summary, then confirms and shows the success state", async () => {
    // eventsInserted (6) is deliberately different from PREVIEW_SUMMARY's
    // newEventRows (8) so this test actually proves the success state reads
    // the commit response, not the preview summary's count.
    const fetchMock = vi
      .fn()
      // mode=preview
      .mockResolvedValueOnce(jsonResponse({ ok: true, summary: PREVIEW_SUMMARY }))
      // mode=commit
      .mockResolvedValueOnce(
        jsonResponse({ ok: true, summary: PREVIEW_SUMMARY, eventsInserted: 6 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const onImported = vi.fn();
    render(<BalanceHistoryImportModal onClose={vi.fn()} onImported={onImported} />);

    const input = screen.getByLabelText("Monarch balance history CSV");
    await pickFile(input, csvFile());

    // Preview summary renders
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toHaveAttribute("data-import-step", "preview");
    });
    expect(screen.getByText("2026-01-01 – 2026-01-03")).toBeInTheDocument();
    expect(screen.getByText("Everyday Checking")).toBeInTheDocument();
    expect(screen.getByText("Legacy Brokerage")).toBeInTheDocument();
    // The archived flag on a new account is surfaced right in the preview —
    // this is exactly the visibility Task 8's Archived-group work is about.
    expect(screen.getByText(/Brokerage · archived/)).toBeInTheDocument();
    expect(screen.getByText("Cash")).toBeInTheDocument();

    // First call was the preview POST with mode=preview, against the
    // balance-history route (not the transactions import route).
    const [firstUrl, firstInit] = fetchMock.mock.calls[0];
    expect(firstUrl).toBe("/api/accounts/balance-history");
    const firstCallBody = firstInit.body as FormData;
    expect(firstCallBody.get("mode")).toBe("preview");
    expect(firstInit.headers["x-csrf-token"]).toBe("test-csrf-token");

    expect(onImported).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Confirm import" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toHaveAttribute("data-import-step", "success");
    });
    // "6" (the commit response's eventsInserted) — not "8", which would mean
    // the component read the preview summary's count instead.
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(screen.getByText(/new balance history events/)).toBeInTheDocument();

    const secondCallBody = fetchMock.mock.calls[1][1].body as FormData;
    expect(secondCallBody.get("mode")).toBe("commit");

    // A committed import has no per-account/per-event response shape to
    // merge locally (see NetWorthClient's comment), so the modal signals
    // the parent to refetch instead — exactly once, the instant commit
    // succeeds (not deferred to clicking "Done").
    expect(onImported).toHaveBeenCalledTimes(1);
  });

  it("closes without calling fetch again when Cancel is clicked from the preview step", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, summary: PREVIEW_SUMMARY }));
    vi.stubGlobal("fetch", fetchMock);

    const onClose = vi.fn();
    render(<BalanceHistoryImportModal onClose={onClose} onImported={vi.fn()} />);

    await pickFile(screen.getByLabelText("Monarch balance history CSV"), csvFile());
    await waitFor(() => screen.getByRole("button", { name: "Confirm import" }));

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the preview — nothing else was ever sent
  });
});

describe("BalanceHistoryImportModal — error path", () => {
  it("surfaces the API's error message verbatim on a bad preview response", async () => {
    const message = "CSV is missing a required column: Balance. Found header: Date, Account";
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({ ok: false, error: { code: "BAD_REQUEST", message } }, false),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<BalanceHistoryImportModal onClose={vi.fn()} onImported={vi.fn()} />);
    await pickFile(screen.getByLabelText("Monarch balance history CSV"), csvFile());

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(message);
    });
    // Reverts to the file picker so the user can try a different file.
    expect(screen.getByRole("dialog")).toHaveAttribute("data-import-step", "pick");
  });

  it("surfaces the API's error message verbatim when confirm fails, keeps the preview visible, and never calls onImported", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, summary: PREVIEW_SUMMARY }))
      .mockResolvedValueOnce(
        jsonResponse({ ok: false, error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } }, false),
      );
    vi.stubGlobal("fetch", fetchMock);

    const onImported = vi.fn();
    render(<BalanceHistoryImportModal onClose={vi.fn()} onImported={onImported} />);
    await pickFile(screen.getByLabelText("Monarch balance history CSV"), csvFile());
    await waitFor(() => screen.getByRole("button", { name: "Confirm import" }));

    await userEvent.click(screen.getByRole("button", { name: "Confirm import" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("An unexpected error occurred.");
    });
    expect(screen.getByRole("dialog")).toHaveAttribute("data-import-step", "preview");
    // The summary itself is still intact so the user can retry without re-uploading.
    expect(screen.getByText("Everyday Checking")).toBeInTheDocument();
    expect(onImported).not.toHaveBeenCalled();
  });

  it("shows a network-error message when fetch itself rejects", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    render(<BalanceHistoryImportModal onClose={vi.fn()} onImported={vi.fn()} />);
    await pickFile(screen.getByLabelText("Monarch balance history CSV"), csvFile());

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Network error.");
    });
  });
});
