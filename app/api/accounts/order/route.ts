import { NextResponse } from "next/server";
import { reorderAccounts } from "@/lib/accounts";
import { parseReorderAccountsBody } from "@/lib/account-validation";
import { withApiHandler } from "@/lib/api/handler";
import { err } from "@/lib/api/errors";

// Saves the drag-and-drop order of one Net Worth section.
export const PUT = withApiHandler(
  { logLabel: "api/accounts/order PUT", csrf: true },
  async ({ req, session }) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return err("BAD_REQUEST", "Invalid JSON body.", 400);
    }

    const parsed = parseReorderAccountsBody(body);
    if (!parsed.ok) {
      return err("VALIDATION_FAILED", "Please correct the errors and try again.", 400, { fieldErrors: parsed.fieldErrors });
    }

    const saved = await reorderAccounts(session.user.id, parsed.value.accountIds);
    if (!saved) return err("NOT_FOUND", "Account not found.", 404);

    return NextResponse.json({ ok: true, data: { accountIds: parsed.value.accountIds } });
  },
);
