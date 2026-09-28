import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { OAUTH_STATE_COOKIE } from "@/lib/auth/oauth-state";

// Google's endpoints are the only external dependency in this flow; the rest
// (state check, linking, session issue, audit) is ours and is what we want to
// exercise against real Postgres.
const google = vi.hoisted(() => ({
  profile: {
    sub: "google-sub-default",
    email: "default@example.test",
    email_verified: true,
    given_name: "Given",
    family_name: "Family",
    picture: undefined as string | undefined,
  },
}));
vi.mock("@/lib/auth/google-oauth", () => ({
  googleCallbackRedirectUri: () => "http://localhost/api/auth/oauth/google/callback",
  exchangeGoogleCode: async () => ({ access_token: "at", expires_in: 3600 }),
  fetchGoogleProfile: async () => google.profile,
}));

const mailed = vi.hoisted(() => ({
  linkNotices: [] as { to: string; linkedEmail: string; provider: string }[],
}));
vi.mock("@/lib/auth/email", () => ({
  sendOauthLinkNotice: async (o: { to: string; linkedEmail: string; provider: string }) => {
    mailed.linkNotices.push(o);
    return { ok: true, delivered: "console" };
  },
  sendPasswordResetEmail: async () => ({ ok: true, delivered: "console" }),
  sendEmailChangeConfirmation: async () => ({ ok: true, delivered: "console" }),
  sendEmailChangeNotice: async () => ({ ok: true, delivered: "console" }),
}));

import { GET } from "../oauth/google/callback/route";
import { seedUser, cleanupUser, authEventTypes } from "./helpers";

const createdUsers: string[] = [];
const STATE = "a".repeat(43);

async function newUser(email?: string) {
  const u = await seedUser(email ? { email } : {});
  createdUsers.push(u.id);
  return u;
}

function callbackRequest() {
  const req = new NextRequest(
    `http://localhost/api/auth/oauth/google/callback?code=the-code&state=${STATE}`,
    { method: "GET" },
  );
  req.cookies.set(OAUTH_STATE_COOKIE, STATE);
  return req;
}

beforeEach(() => {
  mailed.linkNotices.length = 0;
  google.profile = {
    sub: `google-sub-${randomUUID()}`,
    email: `google-${randomUUID()}@example.test`,
    email_verified: true,
    given_name: "Given",
    family_name: "Family",
    picture: undefined,
  };
});

afterEach(async () => {
  for (const id of createdUsers) await cleanupUser(id);
  createdUsers.length = 0;
  // Users the callback created itself are not in createdUsers.
  await prisma.user
    .deleteMany({ where: { email: { contains: "@example.test" }, firstName: "Given" } })
    .catch(() => {});
});

describe("Google callback linking to an existing password account", () => {
  it("links, notifies the account owner, and records the link as its own event", async () => {
    // The chosen posture is frictionless-plus-notify: the link still happens
    // and a session is still issued, but it can no longer happen silently.
    const existing = await newUser();
    google.profile.email = existing.email;

    const res = await GET(callbackRequest());
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/");

    const linked = await prisma.oAuthAccount.findMany({
      where: { userId: existing.id, provider: "google" },
      select: { providerAccountId: true },
    });
    expect(linked).toHaveLength(1);
    expect(linked[0].providerAccountId).toBe(google.profile.sub);

    // The notice goes to the address on the account, which is the channel its
    // real owner reads.
    expect(mailed.linkNotices).toHaveLength(1);
    expect(mailed.linkNotices[0].to).toBe(existing.email);
    expect(mailed.linkNotices[0].provider).toBe("Google");

    const types = await authEventTypes(existing.id);
    expect(types).toContain("oauth_account_linked");
    expect(types).toContain("google_oauth_signin");
  });

  it("issues a session on the existing account", async () => {
    const existing = await newUser();
    google.profile.email = existing.email;

    const res = await GET(callbackRequest());
    expect(res.headers.get("set-cookie") ?? "").toMatch(/sw_session=/);

    const sessions = await prisma.session.count({ where: { userId: existing.id } });
    expect(sessions).toBe(1);
  });

  it("matches on the normalized address, not the raw one", async () => {
    const existing = await newUser(`Mixed-${randomUUID()}@Example.test`);
    google.profile.email = existing.email.toLowerCase();

    await GET(callbackRequest());

    const linked = await prisma.oAuthAccount.count({
      where: { userId: existing.id, provider: "google" },
    });
    expect(linked).toBe(1);
    expect(mailed.linkNotices[0].to).toBe(existing.email);
  });

  it("refuses to link an unverified Google email", async () => {
    const existing = await newUser();
    google.profile.email = existing.email;
    google.profile.email_verified = false;

    const res = await GET(callbackRequest());
    expect(res.headers.get("location")).toContain("oauth=email_unverified");

    const linked = await prisma.oAuthAccount.count({
      where: { userId: existing.id },
    });
    expect(linked).toBe(0);
    expect(mailed.linkNotices).toHaveLength(0);
  });
});

describe("Google callback for a brand-new user", () => {
  it("creates the account without sending a link notice", async () => {
    // Nothing was linked to a pre-existing account, so there is no owner to
    // warn — a notice here would just be noise on every Google signup.
    const res = await GET(callbackRequest());
    expect(res.headers.get("location")).toBe("http://localhost/");

    const created = await prisma.user.findUnique({
      where: { emailNormalized: google.profile.email.toLowerCase() },
      select: { id: true },
    });
    expect(created).not.toBeNull();
    if (created) createdUsers.push(created.id);

    expect(mailed.linkNotices).toHaveLength(0);
    const types = await authEventTypes(created!.id);
    expect(types).toContain("signup");
    expect(types).not.toContain("oauth_account_linked");
  });
});

describe("Google callback on a repeat sign-in", () => {
  it("does not re-notify a link that already exists", async () => {
    const existing = await newUser();
    google.profile.email = existing.email;

    await GET(callbackRequest());
    expect(mailed.linkNotices).toHaveLength(1);

    mailed.linkNotices.length = 0;
    await GET(callbackRequest());

    // Second sign-in resolves via the linked OAuth account, so nothing new
    // was linked and the owner should not be emailed again.
    expect(mailed.linkNotices).toHaveLength(0);
  });
});

describe("Google callback state validation", () => {
  it("rejects a mismatched state nonce", async () => {
    const req = new NextRequest(
      `http://localhost/api/auth/oauth/google/callback?code=c&state=${STATE}`,
      { method: "GET" },
    );
    req.cookies.set(OAUTH_STATE_COOKIE, "b".repeat(43));
    const res = await GET(req);
    expect(res.headers.get("location")).toContain("oauth=invalid_state");
  });

  it("rejects a missing state cookie", async () => {
    const req = new NextRequest(
      `http://localhost/api/auth/oauth/google/callback?code=c&state=${STATE}`,
      { method: "GET" },
    );
    const res = await GET(req);
    expect(res.headers.get("location")).toContain("oauth=invalid_state");
  });
});
