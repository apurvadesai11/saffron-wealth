import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORY_SEED, IMPORT_COLOR_PALETTE } from "./categories";
import { MOCK_CATEGORIES } from "./mock-data";
import { CATEGORICAL_PALETTE } from "./theme-tokens";

// Category.color is a Tailwind class name stored in Postgres. tailwind.config.ts
// safelists exactly the CATEGORICAL_PALETTE backgrounds, so a colour written
// here that isn't in that palette gets no CSS and renders blank. That's the bug
// this guards against: the seed used to name classes Tailwind never generated.
const SAFELISTED = new Set(
  Object.entries(CATEGORICAL_PALETTE).flatMap(([hue, steps]) =>
    Object.keys(steps).map((step) => `bg-${hue}-${step}`),
  ),
);

describe("stored category colours", () => {
  it.each(DEFAULT_CATEGORY_SEED.map((c) => [c.name, c.color]))(
    "the registration seed's %s colour (%s) is safelisted",
    (_name, color) => {
      expect(SAFELISTED.has(color)).toBe(true);
    },
  );

  it.each(IMPORT_COLOR_PALETTE)("the Monarch import colour %s is safelisted", (color) => {
    expect(SAFELISTED.has(color)).toBe(true);
  });

  it.each(MOCK_CATEGORIES.map((c) => [c.name, c.color]))(
    "the fixture category %s colour (%s) is safelisted",
    (_name, color) => {
      expect(SAFELISTED.has(color)).toBe(true);
    },
  );
});
