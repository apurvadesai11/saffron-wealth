import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/server";
import { listAccounts, listArchivedAccounts } from "@/lib/accounts";
import { getCurrentFinancialProfile } from "@/lib/financial-profile";
import { ageOn, contributionAccountOptions } from "@/lib/financial-profile-utils";
import FinancialProfileClient from "@/components/FinancialProfileClient";

export default async function FinancialProfilePage() {
  // Session is already validated by the (app) layout; re-reading it here is a
  // cache hit (getSession is wrapped in React.cache), not an extra query.
  const session = await getSession();
  if (!session) redirect("/login");

  const [profile, accounts, archivedAccounts] = await Promise.all([
    getCurrentFinancialProfile(session.user.id),
    listAccounts(session.user.id),
    listArchivedAccounts(session.user.id),
  ]);

  const referenced = new Set(profile?.contributionTargets.map((t) => t.accountId));

  return (
    <FinancialProfileClient
      initialProfile={profile}
      initialAge={profile ? ageOn(profile, new Date()) : null}
      accounts={contributionAccountOptions(accounts, archivedAccounts, referenced)}
    />
  );
}
