"use client";

import { useMemo } from "react";
import { useApp } from "./app-context";
import {
  formatAlertMessage,
  getCurrentPeriodSpend,
  getDaysRemainingInPeriod,
  getProgressPercent,
  getPeriodKey,
} from "./budget-utils";
import type { ActiveAlert } from "@/components/AlertPanel";

// Returns the reference date for budget calculations:
//   current month → now   |   past month → last day   |   future month → first day
export function getAsOf(month: number, year: number): Date {
  const now = new Date();
  if (year === now.getFullYear() && month === now.getMonth()) return now;
  if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth())) {
    return new Date(year, month + 1, 0);
  }
  return new Date(year, month, 1);
}

interface UseAlertStateResult {
  activeAlerts: ActiveAlert[];
  dismissAlert: (key: string) => void;
  // Used by the budget edit flow: when a budget is increased and spend drops
  // below a previously-dismissed threshold, we want the alert to be eligible
  // to fire again. (FR-19)
  clearDismissedThresholds: (
    categoryId: string,
    periodKey: string,
    thresholds: number[],
  ) => void;
}

// Derives the set of currently-active alerts for the *current* month from
// transactions/budgets/categories in AppContext, filtered by dismissedKeys.
//
// Both the sidebar AlertsButton (top-of-app) and the MonthlyReviewWidget call
// this hook so they share a single source of truth.
export function useAlertState(): UseAlertStateResult {
  const { categories, budgets, transactions, dismissedKeys, setDismissedKeys } = useApp();

  const activeAlerts: ActiveAlert[] = useMemo(() => {
    const now = new Date();
    const asOf = getAsOf(now.getMonth(), now.getFullYear());
    const period = "monthly" as const;
    const periodKey = getPeriodKey(asOf, period);
    const alerts: ActiveAlert[] = [];

    categories
      .filter(cat => cat.type === "expense")
      .forEach(cat => {
        const budget = budgets.find(b => b.categoryId === cat.id && b.period === period);
        if (!budget || budget.amount === 0) return;

        const spent = getCurrentPeriodSpend(transactions, cat.id, period, asOf);
        const percent = getProgressPercent(spent, budget.amount);
        const days = getDaysRemainingInPeriod(asOf, period);

        if (percent >= 80) {
          const key = `${cat.id}-${periodKey}-80`;
          if (!dismissedKeys.has(key)) {
            alerts.push({
              key,
              threshold: 80 as const,
              message: formatAlertMessage(80, cat.name, spent, budget.amount, days),
            });
          }
        }
        if (percent >= 100) {
          const key = `${cat.id}-${periodKey}-100`;
          if (!dismissedKeys.has(key)) {
            alerts.push({
              key,
              threshold: 100 as const,
              message: formatAlertMessage(100, cat.name, spent, budget.amount, days),
            });
          }
        }
      });

    return alerts;
  }, [categories, budgets, transactions, dismissedKeys]);

  function dismissAlert(key: string) {
    setDismissedKeys(prev => new Set([...prev, key]));
  }

  function clearDismissedThresholds(categoryId: string, periodKey: string, thresholds: number[]) {
    setDismissedKeys(prev => {
      const next = new Set(prev);
      let changed = false;
      for (const t of thresholds) {
        const key = `${categoryId}-${periodKey}-${t}`;
        if (next.delete(key)) changed = true;
      }
      return changed ? next : prev;
    });
  }

  return { activeAlerts, dismissAlert, clearDismissedThresholds };
}
