-- CreateTable
CREATE TABLE "FinancialProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ageAtEffective" INTEGER NOT NULL,
    "targetRetirementAge" INTEGER NOT NULL,
    "expectedRealReturnPct" DECIMAL(5,2) NOT NULL,
    "safeWithdrawalRatePct" DECIMAL(5,2) NOT NULL,
    "inflationPct" DECIMAL(5,2) NOT NULL,
    "filingStatus" TEXT,
    "employerMatchPct" DECIMAL(5,2),
    "employerMatchLimitPct" DECIMAL(5,2),

    CONSTRAINT "FinancialProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialProfileIncome" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT,
    "annualAmount" DECIMAL(14,2) NOT NULL,
    "frequency" TEXT,

    CONSTRAINT "FinancialProfileIncome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialProfileContribution" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "annualAmount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "FinancialProfileContribution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FinancialProfile_userId_version_key" ON "FinancialProfile"("userId", "version");

-- CreateIndex
CREATE INDEX "FinancialProfileIncome_profileId_idx" ON "FinancialProfileIncome"("profileId");

-- CreateIndex
CREATE INDEX "FinancialProfileContribution_accountId_idx" ON "FinancialProfileContribution"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialProfileContribution_profileId_accountId_key" ON "FinancialProfileContribution"("profileId", "accountId");

-- AddForeignKey
ALTER TABLE "FinancialProfile" ADD CONSTRAINT "FinancialProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialProfileIncome" ADD CONSTRAINT "FinancialProfileIncome_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "FinancialProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialProfileContribution" ADD CONSTRAINT "FinancialProfileContribution_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "FinancialProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialProfileContribution" ADD CONSTRAINT "FinancialProfileContribution_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
