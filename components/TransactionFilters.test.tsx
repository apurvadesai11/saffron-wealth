import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TransactionFilters, {
  EMPTY_FILTERS,
  filtersFromSearchParams,
  filtersToSearchParams,
} from "./TransactionFilters";
import {
  renderWithApp,
  CAT_GROCERIES,
  CAT_RENT,
  CAT_SALARY,
} from "./__tests__/test-utils";

const CATS = [CAT_GROCERIES, CAT_RENT, CAT_SALARY];

describe("TransactionFilters", () => {
  it("does NOT render the 'Reset filters' button when state is default", () => {
    renderWithApp(
      <TransactionFilters value={EMPTY_FILTERS} onChange={() => {}} onReset={() => {}} />,
      { categories: CATS },
    );
    expect(screen.queryByRole("button", { name: /Reset filters/i })).not.toBeInTheDocument();
  });

  it("renders 'Reset filters' when any filter is set and fires onReset on click", async () => {
    const onReset = vi.fn();
    renderWithApp(
      <TransactionFilters
        value={{ ...EMPTY_FILTERS, search: "coffee" }}
        onChange={() => {}}
        onReset={onReset}
      />,
      { categories: CATS },
    );
    await userEvent.click(screen.getByRole("button", { name: /Reset filters/i }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("typing in search propagates via onChange", async () => {
    const onChange = vi.fn();
    renderWithApp(
      <TransactionFilters value={EMPTY_FILTERS} onChange={onChange} onReset={() => {}} />,
      { categories: CATS },
    );
    await userEvent.type(screen.getByLabelText("Search"), "c");
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ search: "c" }));
  });

  it("selecting a type fires onChange with the new type", async () => {
    const onChange = vi.fn();
    renderWithApp(
      <TransactionFilters value={EMPTY_FILTERS} onChange={onChange} onReset={() => {}} />,
      { categories: CATS },
    );
    await userEvent.selectOptions(screen.getByLabelText("Type"), "income");
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ type: "income" }));
  });

  it("clicking an unselected category chip adds its id to categoryIds", async () => {
    const onChange = vi.fn();
    renderWithApp(
      <TransactionFilters value={EMPTY_FILTERS} onChange={onChange} onReset={() => {}} />,
      { categories: CATS },
    );
    await userEvent.click(screen.getByRole("button", { name: /Groceries/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ categoryIds: [CAT_GROCERIES.id] }),
    );
  });

  it("clicking a selected category chip removes its id", async () => {
    const onChange = vi.fn();
    renderWithApp(
      <TransactionFilters
        value={{ ...EMPTY_FILTERS, categoryIds: [CAT_GROCERIES.id] }}
        onChange={onChange}
        onReset={() => {}}
      />,
      { categories: CATS },
    );
    await userEvent.click(screen.getByRole("button", { name: /Groceries/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ categoryIds: [] }),
    );
  });

  it("renders '(N selected)' when categories are selected", () => {
    renderWithApp(
      <TransactionFilters
        value={{ ...EMPTY_FILTERS, categoryIds: [CAT_GROCERIES.id, CAT_RENT.id] }}
        onChange={() => {}}
        onReset={() => {}}
      />,
      { categories: CATS },
    );
    expect(screen.getByText(/\(2 selected\)/)).toBeInTheDocument();
  });

  it("date and amount inputs each propagate updates via onChange", async () => {
    const onChange = vi.fn();
    renderWithApp(
      <TransactionFilters value={EMPTY_FILTERS} onChange={onChange} onReset={() => {}} />,
      { categories: CATS },
    );
    await userEvent.type(screen.getByLabelText("Min ($)"), "5");
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ amountMin: "5" }));
  });
});

// The URL form of a filter, shared by the transactions API query and by links
// into the page (Monthly Review's cashflow rows).
describe("filter search params", () => {
  it("writes only the filters that are set, under the API's names", () => {
    const sp = filtersToSearchParams({
      ...EMPTY_FILTERS,
      categoryIds: ["cat-rent", "cat-groc"],
      dateFrom: "2026-05-01",
      dateTo: "2026-05-31",
    });

    expect(sp.toString()).toBe("categoryIds=cat-rent%2Ccat-groc&from=2026-05-01&to=2026-05-31");
  });

  it("leaves the type out for All", () => {
    expect(filtersToSearchParams(EMPTY_FILTERS).toString()).toBe("");
  });

  it("reads back every filter it writes", () => {
    const filters = {
      search: "coffee",
      type: "expense" as const,
      categoryIds: ["cat-groc"],
      dateFrom: "2026-05-01",
      dateTo: "2026-05-31",
      amountMin: "5",
      amountMax: "1200.50",
    };

    expect(filtersFromSearchParams(filtersToSearchParams(filters))).toEqual(filters);
  });

  it("starts from no filters when the URL has none", () => {
    expect(filtersFromSearchParams(new URLSearchParams())).toEqual(EMPTY_FILTERS);
  });

  // A hand-edited or stale link shouldn't put a value in a field that the
  // API would then reject, showing an error instead of the list.
  it("drops values the API would reject", () => {
    const sp = new URLSearchParams({
      type: "bogus",
      from: "2026-02-30",
      to: "May",
      amountMin: "-5",
      amountMax: "lots",
      categoryIds: ",cat-groc,,",
    });

    expect(filtersFromSearchParams(sp)).toEqual({ ...EMPTY_FILTERS, categoryIds: ["cat-groc"] });
  });
});
