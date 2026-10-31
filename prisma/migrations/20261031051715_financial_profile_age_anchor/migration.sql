-- The age gets its own anchor date instead of borrowing the version's
-- effectiveAt: a version that leaves the age as derived carries the previous
-- anchor forward (docs/decisions/0014-age-anchored-to-its-own-date.md).
--
-- Hand-written rather than Prisma's draft, which dropped and re-added the
-- column. Existing rows keep their age, and their anchor is the only one they
-- ever had — the version's own date.

-- AlterTable
ALTER TABLE "FinancialProfile" RENAME COLUMN "ageAtEffective" TO "anchoredAge";
ALTER TABLE "FinancialProfile" ADD COLUMN "ageAnchoredAt" TIMESTAMP(3);
UPDATE "FinancialProfile" SET "ageAnchoredAt" = "effectiveAt";
ALTER TABLE "FinancialProfile" ALTER COLUMN "ageAnchoredAt" SET NOT NULL;
