import type { ReactNode } from "react";
import { createElement } from "react";

export interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
}

const iconProps = {
  xmlns: "http://www.w3.org/2000/svg",
  className: "h-5 w-5 shrink-0",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const MonthlyReviewIcon = createElement(
  "svg",
  iconProps,
  // simple bar chart glyph
  createElement("line", { x1: 18, y1: 20, x2: 18, y2: 10 }),
  createElement("line", { x1: 12, y1: 20, x2: 12, y2: 4 }),
  createElement("line", { x1: 6,  y1: 20, x2: 6,  y2: 14 }),
);

const TransactionsIcon = createElement(
  "svg",
  iconProps,
  // arrows up/down (income/expense flow)
  createElement("polyline", { points: "17 1 21 5 17 9" }),
  createElement("path",     { d: "M3 11V9a4 4 0 0 1 4-4h14" }),
  createElement("polyline", { points: "7 23 3 19 7 15" }),
  createElement("path",     { d: "M21 13v2a4 4 0 0 1-4 4H3" }),
);

const ProfileIcon = createElement(
  "svg",
  iconProps,
  // user silhouette
  createElement("path",   { d: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" }),
  createElement("circle", { cx: 12, cy: 7, r: 4 }),
);

// Adding a new feature surface? Append a NavItem here.
export const NAV_ITEMS: NavItem[] = [
  { href: "/",             label: "Monthly Review", icon: MonthlyReviewIcon },
  { href: "/transactions", label: "Transactions",   icon: TransactionsIcon  },
  { href: "/profile",      label: "Profile",        icon: ProfileIcon       },
];
