import { NextResponse } from "next/server";
import { saveFinancialProfile } from "@/lib/financial-profile";
import { parseFinancialProfileBody } from "@/lib/financial-profile-validation";
import { InvalidReferenceError } from "@/lib/db-errors";
import { withApiHandler } from "@/lib/api/handler";
import { err } from "@/lib/api/errors";

// PUT only, like /api/budgets: the page reads the current version through its
// Server Component, and a save always sends the whole profile, because every
// save is a complete new version rather than a patch of the last one.
export const PUT = withApiHandler(
  { logLabel: "api/financial-profile PUT", csrf: true },
  async ({ req, session }) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return err("BAD_REQUEST", "Invalid JSON body.", 400);
    }

    const parsed = parseFinancialProfileBody(body);
    if (!parsed.ok) {
      return err("VALIDATION_FAILED", "Please correct the errors and try again.", 400, {
        fieldErrors: parsed.fieldErrors,
      });
    }

    try {
      const { profile, changed } = await saveFinancialProfile(session.user.id, parsed.value);
      return NextResponse.json({ ok: true, data: { profile, changed } });
    } catch (e) {
      if (e instanceof InvalidReferenceError) {
        return err("VALIDATION_FAILED", e.message, 400, { fieldErrors: { [e.field]: e.message } });
      }
      throw e;
    }
  },
);
