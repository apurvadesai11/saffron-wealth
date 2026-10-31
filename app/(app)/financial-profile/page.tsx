import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/server";
import { listAccounts, listArchivedAccounts } from "@/lib/accounts";
import { getCurrentFinancialProfile } from "@/lib/financial-profile";
import { ageOn, isContributionEligible } from "@/lib/financial-profile-utils";
import FinancialProfileClient from "@/components/FinancialProfileClient";
import type { ContributionAccountOption } from "@/components/ContributionTargetsEditor";

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

  // Archived accounts are offered only when the current version still names
  // one, so that row renders as itself instead of an empty select.
  const referenced = new Set(profile?.contributionTargets.map((t) => t.accountId));
  const options: ContributionAccountOption[] = [
    ...accounts
      .filter((a) => isContributionEligible(a.type))
      .map((a) => ({ id: a.id, name: a.name, type: a.type, archived: false })),
    ...archivedAccounts
      .filter((a) => referenced.has(a.id))
      .map((a) => ({ id: a.id, name: a.name, type: a.type, archived: true })),
  ];

  return (
    <FinancialProfileClient
      initialProfile={profile}
      initialAge={profile ? ageOn(profile, new Date()) : null}
      accounts={options}
    />
  );
}
