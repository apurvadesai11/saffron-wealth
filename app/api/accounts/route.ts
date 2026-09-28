import { NextResponse } from "next/server";
import { listAccounts, createAccount } from "@/lib/accounts";
import { parseCreateAccountBody } from "@/lib/account-validation";
import { withApiHandler } from "@/lib/api/handler";
import { err } from "@/lib/api/errors";

export const GET = withApiHandler(
  { logLabel: "api/accounts GET" },
  async ({ session }) => {
    const accounts = await listAccounts(session.user.id);
    return NextResponse.json({ ok: true, data: { accounts } });
  },
);

export const POST = withApiHandler(
  { logLabel: "api/accounts POST", csrf: true },
  async ({ req, session }) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return err("BAD_REQUEST", "Invalid JSON body.", 400);
    }

    const parsed = parseCreateAccountBody(body);
    if (!parsed.ok) {
      return err("VALIDATION_FAILED", "Please correct the errors and try again.", 400, { fieldErrors: parsed.fieldErrors });
    }

    const account = await createAccount(session.user.id, parsed.value);
    return NextResponse.json({ ok: true, data: { account } }, { status: 201 });
  },
);
