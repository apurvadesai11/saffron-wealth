import { cache } from "react";
import { cookies } from "next/headers";
import { readSession, type SessionWithUser } from "./sessions";

export const SESSION_COOKIE_NAME =
  process.env.NODE_ENV === "production" ? "__Host-sw_session" : "sw_session";

export const getSession = cache(
  async (): Promise<SessionWithUser | null> => {
    const cookieStore = await cookies();
    const raw = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    if (!raw) return null;
    return readSession(raw);
  },
);
