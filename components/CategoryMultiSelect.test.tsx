import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CategoryMultiSelect from "./CategoryMultiSelect";
import { CAT_GROCERIES, CAT_RENT, CAT_SALARY } from "./__tests__/test-utils";

const CATS = [CAT_GROCERIES, CAT_RENT, CAT_SALARY];

function renderSelect(selectedIds: string[] = [], onChange = vi.fn()) {
  render(
    <>
      <CategoryMultiSelect id="cats" categories={CATS} selectedIds={selectedIds} onChange={onChange} />
      <p>Somewhere else on the page</p>
    </>,
  );
  return onChange;
}

const trigger = () => screen.getByRole("button", { name: /^Categories:/ });

describe("CategoryMultiSelect", () => {
  it.each([
    [[], "All categories"],
    [[CAT_RENT.id], "Rent"],
    [[CAT_RENT.id, CAT_GROCERIES.id], "2 categories"],
  ])("summarizes the selection %j on its button as %s", (selected, want) => {
    renderSelect(selected);

    expect(trigger()).toHaveTextContent(want);
  });

  it("opens a searchable list with every category, checked where selected", async () => {
    renderSelect([CAT_RENT.id]);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();

    await userEvent.click(trigger());

    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("searchbox", { name: "Search categories" })).toHaveFocus();
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    expect(screen.getByRole("checkbox", { name: "Rent" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Groceries" })).not.toBeChecked();
  });

  it("adds a category when it's checked and removes it when unchecked", async () => {
    const onAdd = renderSelect([CAT_RENT.id]);
    await userEvent.click(trigger());
    await userEvent.click(screen.getByRole("checkbox", { name: "Groceries" }));
    expect(onAdd).toHaveBeenCalledWith([CAT_RENT.id, CAT_GROCERIES.id]);
  });

  it("removes a selected category when it's unchecked", async () => {
    const onRemove = renderSelect([CAT_RENT.id, CAT_GROCERIES.id]);
    await userEvent.click(trigger());
    await userEvent.click(screen.getByRole("checkbox", { name: "Rent" }));
    expect(onRemove).toHaveBeenCalledWith([CAT_GROCERIES.id]);
  });

  it("narrows the options to names matching the search, ignoring case", async () => {
    renderSelect();
    await userEvent.click(trigger());

    await userEvent.type(screen.getByRole("searchbox", { name: "Search categories" }), "gRo");

    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getByRole("checkbox", { name: "Groceries" })).toBeInTheDocument();
  });

  it("says so when nothing matches the search", async () => {
    renderSelect();
    await userEvent.click(trigger());

    await userEvent.type(screen.getByRole("searchbox", { name: "Search categories" }), "zzz");

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByText("No categories match.")).toBeInTheDocument();
  });

  it("clears every selection from Clear", async () => {
    const onChange = renderSelect([CAT_RENT.id, CAT_GROCERIES.id]);
    await userEvent.click(trigger());

    await userEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("closes on Escape, returning focus to its button", async () => {
    renderSelect();
    await userEvent.click(trigger());

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  });

  it("closes on a click outside it", async () => {
    renderSelect();
    await userEvent.click(trigger());

    await userEvent.click(screen.getByText("Somewhere else on the page"));

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("starts the search empty each time it opens", async () => {
    renderSelect();
    await userEvent.click(trigger());
    await userEvent.type(screen.getByRole("searchbox", { name: "Search categories" }), "rent");
    await userEvent.keyboard("{Escape}");

    await userEvent.click(trigger());

    expect(screen.getByRole("searchbox", { name: "Search categories" })).toHaveValue("");
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  });
});
