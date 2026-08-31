import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/server";
import {
  listAccounts,
  listArchivedAccounts,
  listAccountsForSeries,
  listBalanceEventsForSeries,
} from "@/lib/accounts";
import { computeNetWorthSeries } from "@/lib/net-worth-history";
import NetWorthClient from "@/components/NetWorthClient";

export default async function NetWorthPage() {
  // Session is already validated by the (app) layout; re-reading it here is a
  // cache hit (getSession is wrapped in React.cache), not an extra query.
  const session = await getSession();
  if (!session) redirect("/login");

  const [accounts, archivedAccounts, seriesRoster, seriesEvents] = await Promise.all([
    listAccounts(session.user.id),
    listArchivedAccounts(session.user.id),
    listAccountsForSeries(session.user.id),
    listBalanceEventsForSeries(session.user.id),
  ]);

  // Derived server-side, once, from the raw event log — the chart only ever
  // receives the finished NetWorthPoint[] as a prop and never recomputes it
  // client-side. seriesRoster (not `accounts`) is deliberate: it includes
  // archived accounts, which the series still needs for the years they were
  // open (see lib/accounts.ts's listAccountsForSeries).
  const series = computeNetWorthSeries(seriesEvents, seriesRoster);

  return (
    <NetWorthClient
      initialAccounts={accounts}
      initialArchivedAccounts={archivedAccounts}
      series={series}
    />
  );
}
