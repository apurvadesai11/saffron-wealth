import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MonarchImportModal from "./MonarchImportModal";

// This component talks to /api/transactions/import directly (it doesn't read
// useApp()), so a mocked fetch is the whole test surface — no renderWithApp
// needed. next/navigation's useRouter must still be mocked since the
// component calls router.refresh() after a successful commit.
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const PREVIEW_SUMMARY = {
  totalRows: 5,
  newTransactions: 4,
  duplicateRows: 1,
  newAccounts: [
    { name: "Everyday Checking", guessedType: "cash" },
    { name: "Sunset Credit Card", guessedType: "credit_card" },
  ],
  newCategories: [
    { name: "Groceries", inferredType: "expense" },
    { name: "Salary", inferredType: "income" },
  ],
  dateRange: { from: "2026-01-05", to: "2026-01-15" },
};

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

function csvFile(name = "monarch.csv") {
  return new File(["Date,Amount,Account,Category\n2026-01-01,-1,A,B\n"], name, {
    type: "text/csv",
  });
}

async function pickFile(input: HTMLElement, file: File) {
  await userEvent.upload(input, file);
}

beforeEach(() => {
  refresh.mockClear();
  // readCsrfCookie() reads document.cookie directly — give it something so
  // the header always has a stable value across tests.
  document.cookie = "sw_csrf=test-csrf-token";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MonarchImportModal — preview → confirm → success", () => {
  it("previews the file, shows the summary, then confirms and shows the success state", async () => {
    const fetchMock = vi
      .fn()
      // mode=preview
      .mockResolvedValueOnce(jsonResponse({ ok: true, summary: PREVIEW_SUMMARY }))
      // mode=commit
      .mockResolvedValueOnce(jsonResponse({ ok: true, summary: PREVIEW_SUMMARY, imported: 4, skipped: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<MonarchImportModal onClose={vi.fn()} />);

    const input = screen.getByLabelText("Monarch transactions CSV");
    await pickFile(input, csvFile());

    // Preview summary renders
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toHaveAttribute("data-import-step", "preview");
    });
    expect(screen.getByText("2026-01-05 – 2026-01-15")).toBeInTheDocument();
    expect(screen.getByText("Everyday Checking")).toBeInTheDocument();
    expect(screen.getByText("Credit Card")).toBeInTheDocument();
    expect(screen.getByText("Groceries")).toBeInTheDocument();
    expect(screen.getByText("Expense")).toBeInTheDocument();

    // First call was the preview POST with mode=preview
    const firstCallBody = fetchMock.mock.calls[0][1].body as FormData;
    expect(firstCallBody.get("mode")).toBe("preview");
    expect(fetchMock.mock.calls[0][1].headers["x-csrf-token"]).toBe("test-csrf-token");

    await userEvent.click(screen.getByRole("button", { name: "Confirm import" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toHaveAttribute("data-import-step", "success");
    });
    expect(screen.getByText(/Imported/)).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText(/skipped/)).toBeInTheDocument();

    const secondCallBody = fetchMock.mock.calls[1][1].body as FormData;
    expect(secondCallBody.get("mode")).toBe("commit");

    // Bulk-imported rows have no per-row response to merge locally, so the
    // component leans on a full server refresh instead.
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("closes without calling fetch again when Cancel is clicked from the preview step", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, summary: PREVIEW_SUMMARY }));
    vi.stubGlobal("fetch", fetchMock);

    const onClose = vi.fn();
    render(<MonarchImportModal onClose={onClose} />);

    await pickFile(screen.getByLabelText("Monarch transactions CSV"), csvFile());
    await waitFor(() => screen.getByRole("button", { name: "Confirm import" }));

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the preview — nothing else was ever sent
  });
});

describe("MonarchImportModal — error path", () => {
  it("surfaces the API's error message verbatim on a bad preview response", async () => {
    const message =
      "CSV is missing a required column: Amount. Found header: Date, Merchant, Category, Account";
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({ ok: false, error: { code: "BAD_REQUEST", message } }, false),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<MonarchImportModal onClose={vi.fn()} />);
    await pickFile(screen.getByLabelText("Monarch transactions CSV"), csvFile());

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(message);
    });
    // Reverts to the file picker so the user can try a different file.
    expect(screen.getByRole("dialog")).toHaveAttribute("data-import-step", "pick");
  });

  it("surfaces the API's error message verbatim when confirm fails, and keeps the preview visible", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, summary: PREVIEW_SUMMARY }))
      .mockResolvedValueOnce(
        jsonResponse({ ok: false, error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } }, false),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<MonarchImportModal onClose={vi.fn()} />);
    await pickFile(screen.getByLabelText("Monarch transactions CSV"), csvFile());
    await waitFor(() => screen.getByRole("button", { name: "Confirm import" }));

    await userEvent.click(screen.getByRole("button", { name: "Confirm import" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("An unexpected error occurred.");
    });
    expect(screen.getByRole("dialog")).toHaveAttribute("data-import-step", "preview");
    // The summary itself is still intact so the user can retry without re-uploading.
    expect(screen.getByText("Everyday Checking")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows a network-error message when fetch itself rejects", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    render(<MonarchImportModal onClose={vi.fn()} />);
    await pickFile(screen.getByLabelText("Monarch transactions CSV"), csvFile());

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Network error.");
    });
  });
});
