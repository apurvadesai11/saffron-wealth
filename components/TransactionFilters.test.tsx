import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TransactionFilters, { EMPTY_FILTERS } from "./TransactionFilters";
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
