// Server-only query layer for the financial profile. Append-only: a save never
// updates a row, it inserts the next version — see
// docs/decisions/0013-financial-profile-append-only-versions.md.
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { InvalidReferenceError } from "./db-errors";
import {
  ageOn,
  isContributionEligible,
  profileInputsEqual,
  toProfileInput,
} from "./financial-profile-utils";
import type {
  AccountType,
  ContributionTarget,
  FinancialProfile,
  FinancialProfileInput,
} from "./types";

const WITH_CHILDREN = {
  incomeStreams: { orderBy: { sortOrder: "asc" as const } },
  contributionTargets: { orderBy: { sortOrder: "asc" as const } },
} satisfies Prisma.FinancialProfileInclude;

type ProfileRow = Prisma.FinancialProfileGetPayload<{ include: typeof WITH_CHILDREN }>;

function mapProfile(row: ProfileRow): FinancialProfile {
  return {
    version: row.version,
    effectiveAt: row.effectiveAt.toISOString(),
    anchoredAge: row.anchoredAge,
    ageAnchoredAt: row.ageAnchoredAt.toISOString(),
    targetRetirementAge: row.targetRetirementAge,
    expectedRealReturnPct: row.expectedRealReturnPct.toNumber(),
    safeWithdrawalRatePct: row.safeWithdrawalRatePct.toNumber(),
    inflationPct: row.inflationPct.toNumber(),
    filingStatus: row.filingStatus as FinancialProfile["filingStatus"],
    employerMatch:
      row.employerMatchPct !== null && row.employerMatchLimitPct !== null
        ? {
            matchPct: row.employerMatchPct.toNumber(),
            limitPct: row.employerMatchLimitPct.toNumber(),
          }
        : null,
    incomeStreams: row.incomeStreams.map((s) => ({
      kind: s.kind as FinancialProfile["incomeStreams"][number]["kind"],
      label: s.label,
      annualAmount: s.annualAmount.toNumber(),
      frequency: s.frequency as FinancialProfile["incomeStreams"][number]["frequency"],
    })),
    contributionTargets: row.contributionTargets.map((c) => ({
      accountId: c.accountId,
      annualAmount: c.annualAmount.toNumber(),
    })),
  };
}

export async function getCurrentFinancialProfile(userId: string): Promise<FinancialProfile | null> {
  const row = await prisma.financialProfile.findFirst({
    where: { userId },
    orderBy: { version: "desc" },
    include: WITH_CHILDREN,
  });
  return row ? mapProfile(row) : null;
}

// Ownership, not activity: an archived account stays a valid target, because a
// version saved before the archive still names it and re-saving the profile
// must not be refused over it.
async function assertContributionAccounts(
  tx: Prisma.TransactionClient,
  userId: string,
  targets: ContributionTarget[],
): Promise<void> {
  if (targets.length === 0) return;
  const accounts = await tx.account.findMany({
    where: { userId, id: { in: targets.map((t) => t.accountId) } },
    select: { id: true, type: true },
  });
  const typeById = new Map(accounts.map((a) => [a.id, a.type as AccountType]));
  targets.forEach((t, i) => {
    const field = `contributionTargets.${i}.accountId`;
    const type = typeById.get(t.accountId);
    if (type === undefined) {
      throw new InvalidReferenceError(field, "Choose one of your accounts.");
    }
    if (!isContributionEligible(type)) {
      throw new InvalidReferenceError(
        field,
        "Contribution targets can only point at cash, investment, or retirement accounts.",
      );
    }
  });
}

/**
 * Save the profile as a new version, or return the current one unchanged when
 * the input says nothing new. `now` is injectable so tests can save "a year
 * later" and exercise the derived-age comparison.
 */
export async function saveFinancialProfile(
  userId: string,
  input: FinancialProfileInput,
  now: Date = new Date(),
): Promise<{ profile: FinancialProfile; changed: boolean }> {
  return prisma.$transaction(async (tx) => {
    // Held until commit, so a concurrent save waits here instead of reading
    // the same latest version and colliding on @@unique([userId, version]).
    // $executeRaw rather than $queryRaw: see acquireLoginLock in
    // lib/auth/exponential-backoff.ts.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`financial-profile:${userId}`}))`;

    await assertContributionAccounts(tx, userId, input.contributionTargets);

    const latestRow = await tx.financialProfile.findFirst({
      where: { userId },
      orderBy: { version: "desc" },
      include: WITH_CHILDREN,
    });
    const latest = latestRow ? mapProfile(latestRow) : null;
    if (latest && profileInputsEqual(toProfileInput(latest, now), input)) {
      return { profile: latest, changed: false };
    }

    // The derived age typed back unchanged is not a new statement about the
    // age, so it keeps the old anchor. Re-anchoring it to `now` would drop the
    // part-year already elapsed on every edit, and someone who saves more
    // than once a year would never get older. Only a different number moves
    // the anchor. See docs/decisions/0014-age-anchored-to-its-own-date.md.
    const anchor =
      latest !== null && input.age === ageOn(latest, now)
        ? { anchoredAge: latest.anchoredAge, ageAnchoredAt: new Date(latest.ageAnchoredAt) }
        : { anchoredAge: input.age, ageAnchoredAt: now };

    const created = await tx.financialProfile.create({
      data: {
        userId,
        version: (latest?.version ?? 0) + 1,
        effectiveAt: now,
        ...anchor,
        targetRetirementAge: input.targetRetirementAge,
        expectedRealReturnPct: input.expectedRealReturnPct,
        safeWithdrawalRatePct: input.safeWithdrawalRatePct,
        inflationPct: input.inflationPct,
        filingStatus: input.filingStatus,
        employerMatchPct: input.employerMatch?.matchPct ?? null,
        employerMatchLimitPct: input.employerMatch?.limitPct ?? null,
        incomeStreams: {
          create: input.incomeStreams.map((s, sortOrder) => ({
            sortOrder,
            kind: s.kind,
            label: s.label,
            annualAmount: s.annualAmount,
            frequency: s.frequency,
          })),
        },
        contributionTargets: {
          create: input.contributionTargets.map((c, sortOrder) => ({
            sortOrder,
            accountId: c.accountId,
            annualAmount: c.annualAmount,
          })),
        },
      },
      include: WITH_CHILDREN,
    });
    return { profile: mapProfile(created), changed: true };
  });
}
