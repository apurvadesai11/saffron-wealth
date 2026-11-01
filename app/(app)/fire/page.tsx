import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/server";
import { listAccounts, listArchivedAccounts } from "@/lib/accounts";
import { getCurrentFinancialProfile } from "@/lib/financial-profile";
import { listTransactions } from "@/lib/transactions";
import { MONTHLY_CPI } from "@/lib/cpi-data";
import { buildFireInputs } from "@/lib/fire-inputs";
import FireCalculatorClient from "@/components/FireCalculatorClient";

export default async function FirePage() {
  // Session is already validated by the (app) layout; re-reading it here is a
  // cache hit (getSession is wrapped in React.cache), not an extra query.
  const session = await getSession();
  if (!session) redirect("/login");

  // The whole transaction history, not AppProvider's 13-month window: the
  // spending baseline averages every complete month, restated in today's
  // dollars. The CPI table is read here, on the server, so its rows stay out
  // of the client bundle; the client gets only the reduced FireInputs.
  const [profile, accounts, archivedAccounts, transactions] = await Promise.all([
    getCurrentFinancialProfile(session.user.id),
    listAccounts(session.user.id),
    listArchivedAccounts(session.user.id),
    listTransactions(session.user.id),
  ]);

  const page = buildFireInputs({
    profile,
    accounts,
    archivedAccounts,
    transactions,
    asOf: new Date(),
    cpi: MONTHLY_CPI,
  });

  return <FireCalculatorClient page={page} />;
}
