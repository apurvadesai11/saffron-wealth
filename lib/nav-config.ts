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

const NetWorthIcon = createElement(
  "svg",
  iconProps,
  // balance scale (assets vs liabilities)
  createElement("line", { x1: 12, y1: 3,  x2: 12, y2: 21 }),
  createElement("path", { d: "M5 7h14" }),
  createElement("path", { d: "M6 7l-3 6a3 3 0 0 0 6 0z" }),
  createElement("path", { d: "M18 7l-3 6a3 3 0 0 0 6 0z" }),
);

const FinancialProfileIcon = createElement(
  "svg",
  iconProps,
  // sliders (adjustable assumptions)
  createElement("line", { x1: 4,  y1: 21, x2: 4,  y2: 14 }),
  createElement("line", { x1: 4,  y1: 10, x2: 4,  y2: 3  }),
  createElement("line", { x1: 12, y1: 21, x2: 12, y2: 12 }),
  createElement("line", { x1: 12, y1: 8,  x2: 12, y2: 3  }),
  createElement("line", { x1: 20, y1: 21, x2: 20, y2: 16 }),
  createElement("line", { x1: 20, y1: 12, x2: 20, y2: 3  }),
  createElement("line", { x1: 1,  y1: 14, x2: 7,  y2: 14 }),
  createElement("line", { x1: 9,  y1: 8,  x2: 15, y2: 8  }),
  createElement("line", { x1: 17, y1: 16, x2: 23, y2: 16 }),
);

const ProfileIcon = createElement(
  "svg",
  iconProps,
  // person silhouette
  createElement("path", { d: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" }),
  createElement("circle", { cx: 12, cy: 7, r: 4 }),
);

// Adding a new feature surface? Add a NavItem to the section it belongs in.
// The sidebar draws a divider between sections: the money pages first, then
// the pages that configure them.
export const NAV_SECTIONS: NavItem[][] = [
  [
    { href: "/net-worth",      label: "Net Worth",      icon: NetWorthIcon      },
    { href: "/monthly-review", label: "Monthly Review", icon: MonthlyReviewIcon },
    { href: "/transactions",   label: "Transactions",   icon: TransactionsIcon  },
  ],
  [
    { href: "/financial-profile", label: "Financial Profile", icon: FinancialProfileIcon },
    { href: "/profile",           label: "Profile",           icon: ProfileIcon          },
  ],
];
