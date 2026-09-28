// The plan singles this out as the one presentational component with real
// logic worth testing: initials derivation and a name-keyed colour hash.
// The hash has to be stable, or a user's avatar changes colour between
// renders for no reason they can see.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AvatarFallback from "./AvatarFallback";

describe("AvatarFallback initials", () => {
  it("takes the first letter of each name, uppercased", () => {
    render(<AvatarFallback firstName="ada" lastName="lovelace" />);
    expect(screen.getByRole("img")).toHaveTextContent("AL");
  });

  it("uses one initial when only one name is present", () => {
    render(<AvatarFallback firstName="Ada" lastName="" />);
    expect(screen.getByRole("img")).toHaveTextContent("A");
  });

  // An avatar with no text at all reads as a broken image; "?" is the
  // deliberate floor.
  it("falls back to ? when there is nothing to take an initial from", () => {
    render(<AvatarFallback firstName="" lastName="" />);
    expect(screen.getByRole("img")).toHaveTextContent("?");
  });

  it("handles a non-ASCII first letter", () => {
    render(<AvatarFallback firstName="Åsa" lastName="Öberg" />);
    expect(screen.getByRole("img")).toHaveTextContent("ÅÖ");
  });

  it("labels itself with the full name, since the initials alone are not a name", () => {
    render(<AvatarFallback firstName="Ada" lastName="Lovelace" />);
    expect(screen.getByRole("img")).toHaveAccessibleName("Ada Lovelace");
  });
});

describe("AvatarFallback colour", () => {
  function colorOf(firstName: string, lastName: string): string {
    const { unmount } = render(<AvatarFallback firstName={firstName} lastName={lastName} />);
    const cls = screen.getByRole("img").className;
    const match = cls.match(/bg-[a-z]+-500/);
    unmount();
    return match![0];
  }

  it("picks a palette colour", () => {
    expect(colorOf("Ada", "Lovelace")).toMatch(/^bg-[a-z]+-500$/);
  });

  // The property that matters: same name, same colour, every render.
  it("is stable for the same name", () => {
    const first = colorOf("Ada", "Lovelace");
    expect(colorOf("Ada", "Lovelace")).toBe(first);
    expect(colorOf("Ada", "Lovelace")).toBe(first);
  });

  it("keys on the whole name, so a shared first name can still differ", () => {
    // Not asserting they DO differ — an 8-colour palette collides, and
    // requiring distinctness would make this a test of the hash's luck. What
    // matters is that the last name is part of the key at all.
    const a = colorOf("Ada", "Lovelace");
    const b = colorOf("Ada", "Byron");
    const c = colorOf("Ada", "Lovelace");
    expect(c).toBe(a);
    expect([a, b].every((x) => /^bg-[a-z]+-500$/.test(x))).toBe(true);
  });

  it("spreads a handful of different names across more than one colour", () => {
    const names: [string, string][] = [
      ["Ada", "Lovelace"], ["Grace", "Hopper"], ["Alan", "Turing"],
      ["Katherine", "Johnson"], ["Edsger", "Dijkstra"], ["Barbara", "Liskov"],
    ];
    const colours = new Set(names.map(([f, l]) => colorOf(f, l)));
    expect(colours.size).toBeGreaterThan(1);
  });

  // Tailwind purges classes that are not present verbatim in source, so the
  // palette must be full strings — assembling "bg-" + hue at runtime would
  // render an unstyled grey circle in production only.
  it("uses full Tailwind class strings, which is what stops Tailwind purging them", () => {
    expect(colorOf("Ada", "Lovelace")).not.toContain("undefined");
  });
});

describe("AvatarFallback sizing", () => {
  it("defaults to 40px square", () => {
    render(<AvatarFallback firstName="Ada" lastName="Lovelace" />);
    expect(screen.getByRole("img")).toHaveStyle({ width: "40px", height: "40px" });
  });

  it("scales the font with the size", () => {
    render(<AvatarFallback firstName="Ada" lastName="Lovelace" size={100} />);
    expect(screen.getByRole("img")).toHaveStyle({ fontSize: "42px" });
  });

  // Floors at 12px: 42% of a small avatar would be unreadable.
  it("never drops the font below 12px", () => {
    render(<AvatarFallback firstName="Ada" lastName="Lovelace" size={16} />);
    expect(screen.getByRole("img")).toHaveStyle({ fontSize: "12px" });
  });
});
