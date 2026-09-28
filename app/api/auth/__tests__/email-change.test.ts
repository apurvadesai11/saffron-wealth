import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "@/lib/auth/csrf-shared";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ sessionToken: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      (name === "sw_session" || name === "__Host-sw_session") && mocks.sessionToken
        ? { value: mocks.sessionToken }
        : undefined,
  }),
}));

// Mail delivery is out of scope here and would print to console on every run;
// spying also lets the tests assert WHICH addresses were written to, which is
// the security-relevant part (the old address must be told).
const mailed = vi.hoisted(() => ({
  confirmations: [] as { to: string; confirmUrl: string }[],
  notices: [] as { to: string; newEmail: string }[],
}));
vi.mock("@/lib/auth/email", () => ({
  sendEmailChangeConfirmation: async (o: { to: string; confirmUrl: string }) => {
    mailed.confirmations.push({ to: o.to, confirmUrl: o.confirmUrl });
    return { ok: true, delivered: "console" };
  },
  sendEmailChangeNotice: async (o: { to: string; newEmail: string }) => {
    mailed.notices.push({ to: o.to, newEmail: o.newEmail });
    return { ok: true, delivered: "console" };
  },
  sendPasswordResetEmail: async () => ({ ok: true, delivered: "console" }),
  sendOauthLinkNotice: async () => ({ ok: true, delivered: "console" }),
}));

import { PATCH } from "../../profile/route";
import { POST as CONFIRM } from "../email-change/confirm/route";
import { seedUser, seedSession, cleanupUser, authEventTypes } from "./helpers";
import { __resetRateLimiterForTests } from "@/lib/auth/rate-limit";

const createdUsers: string[] = [];

async function newUser(password?: string) {
  const u = await seedUser(password ? { password } : {});
  createdUsers.push(u.id);
  return u;
}

function patchRequest(body: unknown, csrfToken: string) {
  const headers = new Headers({
    "content-type": "application/json",
    [CSRF_HEADER_NAME]: csrfToken,
  });
  const req = new NextRequest("http://localhost/api/profile", {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
  req.cookies.set(CSRF_COOKIE_NAME, csrfToken);
  return req;
}

function confirmRequest(body: unknown, csrfToken: string) {
  const headers = new Headers({
    "content-type": "application/json",
    [CSRF_HEADER_NAME]: csrfToken,
  });
  const req = new NextRequest("http://localhost/api/auth/email-change/confirm", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  req.cookies.set(CSRF_COOKIE_NAME, csrfToken);
  return req;
}

// The confirmUrl the route builds ends in the raw token.
function tokenFromUrl(url: string): string {
  return decodeURIComponent(url.split("/").pop()!);
}

const CSRF = "test-csrf-token-value";

beforeEach(() => {
  mocks.sessionToken = null;
  mailed.confirmations.length = 0;
  mailed.notices.length = 0;
  __resetRateLimiterForTests();
});

afterEach(async () => {
  for (const id of createdUsers) await cleanupUser(id);
  createdUsers.length = 0;
});

describe("PATCH /api/profile — email is no longer applied directly", () => {
  it("leaves User.email untouched and issues a pending change", async () => {
    const user = await newUser();
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const target = `claimed-${randomUUID()}@example.test`;
    const res = await PATCH(patchRequest({ email: target }, CSRF));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.emailChangePending).toBe(true);
    expect(body.data.pendingEmail).toBe(target);
    // The returned user must still carry the OLD address.
    expect(body.data.user.email).toBe(user.email);

    const fresh = await prisma.user.findUnique({
      where: { id: user.id },
      select: { email: true, emailNormalized: true },
    });
    expect(fresh?.email).toBe(user.email);
    expect(fresh?.emailNormalized).toBe(user.emailNormalized);

    const pending = await prisma.emailChangeToken.findMany({
      where: { userId: user.id, consumedAt: null },
    });
    expect(pending).toHaveLength(1);
    expect(pending[0].newEmailNormalized).toBe(target.toLowerCase());
  });

  it("emails the confirmation to the NEW address and a notice to the OLD one", async () => {
    const user = await newUser();
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const target = `claimed-${randomUUID()}@example.test`;
    await PATCH(patchRequest({ email: target }, CSRF));

    expect(mailed.confirmations.map(c => c.to)).toEqual([target]);
    expect(mailed.notices.map(n => n.to)).toEqual([user.email]);
    expect(mailed.notices[0].newEmail).toBe(target);
  });

  it("applies a name change immediately even while an email change is pending", async () => {
    const user = await newUser();
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const res = await PATCH(
      patchRequest({ firstName: "Renamed", email: `x-${randomUUID()}@example.test` }, CSRF),
    );
    const body = await res.json();
    expect(body.data.user.firstName).toBe("Renamed");
    expect(body.data.user.email).toBe(user.email);
  });

  it("records email_change_requested, not email_change", async () => {
    const user = await newUser();
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    await PATCH(patchRequest({ email: `x-${randomUUID()}@example.test` }, CSRF));

    const types = await authEventTypes(user.id);
    expect(types).toContain("email_change_requested");
    expect(types).not.toContain("email_change");
  });

  it("does not revoke sessions at request time", async () => {
    const user = await newUser();
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    await PATCH(patchRequest({ email: `x-${randomUUID()}@example.test` }, CSRF));

    const sessions = await prisma.session.count({ where: { userId: user.id } });
    expect(sessions).toBe(1);
  });

  it("still rejects an address another user already owns", async () => {
    const victim = await newUser();
    const attacker = await newUser();
    const { rawToken } = await seedSession(attacker.id);
    mocks.sessionToken = rawToken;

    const res = await PATCH(patchRequest({ email: victim.email }, CSRF));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("EMAIL_EXISTS");
    expect(mailed.confirmations).toHaveLength(0);
  });

  it("supersedes an earlier pending token when a different address is requested", async () => {
    const user = await newUser();
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    await PATCH(patchRequest({ email: `first-${randomUUID()}@example.test` }, CSRF));
    const firstToken = tokenFromUrl(mailed.confirmations[0].confirmUrl);

    await PATCH(patchRequest({ email: `second-${randomUUID()}@example.test` }, CSRF));

    // The superseded link must stop working.
    const res = await CONFIRM(confirmRequest({ token: firstToken }, CSRF));
    expect(res.status).toBe(400);
    const unchanged = await prisma.user.findUnique({
      where: { id: user.id },
      select: { email: true },
    });
    expect(unchanged?.email).toBe(user.email);
  });
});

describe("POST /api/auth/email-change/confirm", () => {
  async function requestChange(userId: string) {
    const { rawToken } = await seedSession(userId);
    mocks.sessionToken = rawToken;
    const target = `confirmed-${randomUUID()}@example.test`;
    await PATCH(patchRequest({ email: target }, CSRF));
    const token = tokenFromUrl(
      mailed.confirmations[mailed.confirmations.length - 1].confirmUrl,
    );
    return { token, target };
  }

  it("applies the address, consumes the token and revokes sessions", async () => {
    const user = await newUser();
    const { token, target } = await requestChange(user.id);

    const res = await CONFIRM(confirmRequest({ token }, CSRF));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.email).toBe(target);

    const fresh = await prisma.user.findUnique({
      where: { id: user.id },
      select: { email: true, emailNormalized: true },
    });
    expect(fresh?.email).toBe(target);
    expect(fresh?.emailNormalized).toBe(target.toLowerCase());

    const unconsumed = await prisma.emailChangeToken.count({
      where: { userId: user.id, consumedAt: null },
    });
    expect(unconsumed).toBe(0);

    const types = await authEventTypes(user.id);
    expect(types).toContain("email_change");
    expect(types).toContain("session_revoked");
  });

  it("issues a fresh session cookie on the confirming device", async () => {
    const user = await newUser();
    const { token } = await requestChange(user.id);

    const res = await CONFIRM(confirmRequest({ token }, CSRF));
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/sw_session=/);

    // Exactly one live session: the pre-existing one was revoked.
    const sessions = await prisma.session.count({ where: { userId: user.id } });
    expect(sessions).toBe(1);
  });

  it("is single-use", async () => {
    const user = await newUser();
    const { token } = await requestChange(user.id);

    const first = await CONFIRM(confirmRequest({ token }, CSRF));
    expect(first.status).toBe(200);

    const second = await CONFIRM(confirmRequest({ token }, CSRF));
    expect(second.status).toBe(400);
    const body = await second.json();
    expect(body.error.code).toBe("INVALID_TOKEN");
  });

  it("rejects an expired token", async () => {
    const user = await newUser();
    const { token } = await requestChange(user.id);

    // Age the token past its 15-minute TTL.
    await prisma.emailChangeToken.updateMany({
      where: { userId: user.id, consumedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await CONFIRM(confirmRequest({ token }, CSRF));
    expect(res.status).toBe(400);
    const unchanged = await prisma.user.findUnique({
      where: { id: user.id },
      select: { email: true },
    });
    expect(unchanged?.email).toBe(user.email);
  });

  it("rejects a garbage token without leaking which part was wrong", async () => {
    const res = await CONFIRM(confirmRequest({ token: "not-a-real-token" }, CSRF));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_TOKEN");
    expect(body.error.message).toBe("This link is invalid or has expired.");
  });

  it("requires CSRF", async () => {
    const user = await newUser();
    const { token } = await requestChange(user.id);

    const headers = new Headers({ "content-type": "application/json" });
    const req = new NextRequest("http://localhost/api/auth/email-change/confirm", {
      method: "POST",
      headers,
      body: JSON.stringify({ token }),
    });
    const res = await CONFIRM(req);
    expect(res.status).toBe(403);
  });

  it("re-checks uniqueness at confirm time, not just at request time", async () => {
    // The whole point of the re-check: the address was free when the link was
    // sent and is taken by the time it is used.
    const user = await newUser();
    const { token, target } = await requestChange(user.id);

    const squatter = await newUser();
    await prisma.user.update({
      where: { id: squatter.id },
      data: { email: target, emailNormalized: target.toLowerCase() },
    });

    const res = await CONFIRM(confirmRequest({ token }, CSRF));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("EMAIL_EXISTS");

    const unchanged = await prisma.user.findUnique({
      where: { id: user.id },
      select: { email: true },
    });
    expect(unchanged?.email).toBe(user.email);

    // The token is burned — the claim can never succeed, so leaving it live
    // would only invite retries.
    const stillUsable = await prisma.emailChangeToken.count({
      where: { userId: user.id, consumedAt: null },
    });
    expect(stillUsable).toBe(0);
  });
});

describe("the account-takeover chain fails at the email-change step", () => {
  it("an attacker cannot park on an address they do not control", async () => {
    // The original chain: attacker registers, PATCHes their email to the
    // victim's address (which succeeded, since the victim had no account
    // yet), then waited for the victim to sign in with Google — whereupon the
    // callback matched by email and handed the victim a session on the
    // ATTACKER's row, financial data and all.
    const attacker = await newUser("attacker-password-1234");
    const { rawToken } = await seedSession(attacker.id);
    mocks.sessionToken = rawToken;

    const victimAddress = `victim-${randomUUID()}@corp.test`;

    const res = await PATCH(patchRequest({ email: victimAddress }, CSRF));
    expect(res.status).toBe(200);

    // Step one of the chain is now inert: the attacker's row does NOT hold the
    // victim's address, so the OAuth callback's email match cannot find it.
    const attackerRow = await prisma.user.findUnique({
      where: { id: attacker.id },
      select: { email: true, emailNormalized: true },
    });
    expect(attackerRow?.emailNormalized).toBe(attacker.emailNormalized);
    expect(attackerRow?.emailNormalized).not.toBe(victimAddress.toLowerCase());

    const matchByVictimAddress = await prisma.user.findUnique({
      where: { emailNormalized: victimAddress.toLowerCase() },
      select: { id: true },
    });
    expect(matchByVictimAddress).toBeNull();

    // And the confirmation went to the victim's inbox, which the attacker
    // cannot read — so the claim can never be completed.
    expect(mailed.confirmations.map(c => c.to)).toEqual([victimAddress]);
  });
});
