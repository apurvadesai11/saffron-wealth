import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/server";
import { listAccounts } from "@/lib/accounts";
import NetWorthClient from "@/components/NetWorthClient";

export default async function NetWorthPage() {
  // Session is already validated by the (app) layout; re-reading it here is a
  // cache hit (getSession is wrapped in React.cache), not an extra query.
  const session = await getSession();
  if (!session) redirect("/login");

  const accounts = await listAccounts(session.user.id);

  return <NetWorthClient initialAccounts={accounts} />;
}
