import { NextResponse, type NextRequest } from "next/server";
import { updateAccount, archiveAccount } from "@/lib/accounts";
import { parseUpdateAccountBody } from "@/lib/account-validation";
import { withApiHandler } from "@/lib/api/handler";
import { err } from "@/lib/api/errors";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export const PATCH = withApiHandler<RouteParams>(
  { logLabel: "api/accounts/[id] PATCH", csrf: true },
  async ({ req, session, routeContext }) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return err("BAD_REQUEST", "Invalid JSON body.", 400);
    }

    const parsed = parseUpdateAccountBody(body);
    if (!parsed.ok) {
      return err("VALIDATION_FAILED", "Please correct the errors and try again.", 400, { fieldErrors: parsed.fieldErrors });
    }

    const { id } = await routeContext.params;
    const account = await updateAccount(session.user.id, id, parsed.value);
    if (!account) return err("NOT_FOUND", "Account not found.", 404);

    return NextResponse.json({ ok: true, data: { account } });
  },
);

export const DELETE = withApiHandler<RouteParams>(
  { logLabel: "api/accounts/[id] DELETE", csrf: true },
  async ({ session, routeContext }) => {
    const { id } = await routeContext.params;
    const deleted = await archiveAccount(session.user.id, id);
    if (!deleted) return err("NOT_FOUND", "Account not found.", 404);

    return NextResponse.json({ ok: true, data: { id } });
  },
);
