import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/server";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        {
          ok: false,
          error: { code: "UNAUTHENTICATED", message: "Not signed in" },
        },
        { status: 401 },
      );
    }
    return NextResponse.json({ ok: true, data: { user: session.user } });
  } catch (e) {
    console.error("[api/auth/me] unhandled error", e);
    return NextResponse.json(
      { ok: false, error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } },
      { status: 500 },
    );
  }
}
