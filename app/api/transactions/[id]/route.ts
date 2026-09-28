import { NextResponse } from "next/server";
import { deleteTransaction } from "@/lib/transactions";
import { withApiHandler } from "@/lib/api/handler";
import { err } from "@/lib/api/errors";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export const DELETE = withApiHandler<RouteParams>(
  { logLabel: "api/transactions/[id] DELETE", csrf: true },
  async ({ session, routeContext }) => {
    const { id } = await routeContext.params;
    const deleted = await deleteTransaction(session.user.id, id);
    if (!deleted) return err("NOT_FOUND", "Transaction not found.", 404);

    return NextResponse.json({ ok: true, data: { id } });
  },
);
