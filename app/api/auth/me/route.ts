import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/server";
import { err, internalError } from "@/lib/api/errors";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return err("UNAUTHENTICATED", "Not signed in", 401);
    }
    return NextResponse.json({ ok: true, data: { user: session.user } });
  } catch (e) {
    console.error("[api/auth/me] unhandled error", e);
    return internalError();
  }
}
