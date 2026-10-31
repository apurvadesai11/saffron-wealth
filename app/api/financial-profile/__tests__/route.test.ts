import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

const mocks = vi.hoisted(() => ({ sessionToken: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      (name === "sw_session" || name === "__Host-sw_session") && mocks.sessionToken
        ? { value: mocks.sessionToken }
        : undefined,
  }),
}));

import { PUT } from "../route";
import { getCurrentFinancialProfile, saveFinancialProfile } from "@/lib/financial-profile";
import type { FinancialProfileInput } from "@/lib/types";
import { seedUser, seedSession, seedAccount, makeRequest, cleanupUser } from "./helpers";

let userIds: string[] = [];

beforeEach(() => {
  mocks.sessionToken = null;
});

afterEach(async () => {
  for (const id of userIds) await cleanupUser(id);
  userIds = [];
});

async function signedInUser() {
  const user = await seedUser();
  userIds.push(user.id);
  const { rawToken } = await seedSession(user.id);
  mocks.sessionToken = rawToken;
  return user;
}

function validBody(accountId: string | null, overrides: Partial<FinancialProfileInput> = {}) {
  return {
    age: 35,
    targetRetirementAge: 50,
    expectedRealReturnPct: 5,
    safeWithdrawalRatePct: 3.5,
    inflationPct: 2.5,
    filingStatus: "single",
    employerMatch: { matchPct: 50, limitPct: 6 },
    incomeStreams: [
      { kind: "salary", label: null, annualAmount: 90000, frequency: "biweekly" },
      { kind: "rsu", label: "Example Co RSUs", annualAmount: 20000, frequency: "quarterly" },
    ],
    contributionTargets: accountId ? [{ accountId, annualAmount: 23000 }] : [],
    ...overrides,
  };
}

async function put(body: unknown) {
  const res = await PUT(makeRequest({ method: "PUT", csrfToken: "csrf", body }));
  return { res, json: await res.json() };
}

async function versionCount(userId: string) {
  return prisma.financialProfile.count({ where: { userId } });
}

describe("PUT /api/financial-profile — gates", () => {
  it("returns 401 when not signed in", async () => {
    const res = await PUT(makeRequest({ method: "PUT", csrfToken: "csrf", body: validBody(null) }));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects requests with no CSRF token", async () => {
    await signedInUser();
    const res = await PUT(makeRequest({ method: "PUT", body: validBody(null) }));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("CSRF_FAILED");
  });

  it("rejects a malformed JSON body", async () => {
    await signedInUser();
    const res = await PUT(makeRequest({ method: "PUT", csrfToken: "csrf", bodyOverride: "{not json" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("BAD_REQUEST");
  });

  it("returns field errors and writes nothing for invalid input", async () => {
    const user = await signedInUser();
    const { res, json } = await put({ ...validBody(null), age: undefined });
    expect(res.status).toBe(400);
    expect(json.error.code).toBe("VALIDATION_FAILED");
    expect(json.error.fieldErrors.age).toBe("Required.");
    expect(await versionCount(user.id)).toBe(0);
  });
});

describe("PUT /api/financial-profile — versions", () => {
  it("saves the first version with its children in order", async () => {
    const user = await signedInUser();
    const account = await seedAccount(user.id);
    const { res, json } = await put(validBody(account.id));

    expect(res.status).toBe(200);
    expect(json.data.changed).toBe(true);
    expect(json.data.profile).toMatchObject({
      version: 1,
      ageAtEffective: 35,
      targetRetirementAge: 50,
      expectedRealReturnPct: 5,
      safeWithdrawalRatePct: 3.5,
      inflationPct: 2.5,
      filingStatus: "single",
      employerMatch: { matchPct: 50, limitPct: 6 },
      incomeStreams: [
        { kind: "salary", label: null, annualAmount: 90000, frequency: "biweekly" },
        { kind: "rsu", label: "Example Co RSUs", annualAmount: 20000, frequency: "quarterly" },
      ],
      contributionTargets: [{ accountId: account.id, annualAmount: 23000 }],
    });
    expect(typeof json.data.profile.effectiveAt).toBe("string");
  });

  it("appends a new version on a change and leaves the old one intact", async () => {
    const user = await signedInUser();
    await put(validBody(null));
    const { json } = await put(validBody(null, { inflationPct: 3 }));

    expect(json.data.changed).toBe(true);
    expect(json.data.profile.version).toBe(2);
    const rows = await prisma.financialProfile.findMany({
      where: { userId: user.id },
      orderBy: { version: "asc" },
    });
    expect(rows.map((r) => [r.version, r.inflationPct.toNumber()])).toEqual([
      [1, 2.5],
      [2, 3],
    ]);
  });

  it("writes nothing for an identical re-save", async () => {
    const user = await signedInUser();
    await put(validBody(null));
    const { res, json } = await put(validBody(null));

    expect(res.status).toBe(200);
    expect(json.data.changed).toBe(false);
    expect(json.data.profile.version).toBe(1);
    expect(await versionCount(user.id)).toBe(1);
  });

  it("a re-save of a 3-decimal percent is a no-op", async () => {
    const user = await signedInUser();
    await put(validBody(null, { expectedRealReturnPct: 3.255 }));
    const { json } = await put(validBody(null, { expectedRealReturnPct: 3.255 }));

    expect(json.data.changed).toBe(false);
    expect(json.data.profile.expectedRealReturnPct).toBe(3.26);
    expect(await versionCount(user.id)).toBe(1);
  });

  it("removing the employer match is a change", async () => {
    await signedInUser();
    await put(validBody(null));
    const { json } = await put(validBody(null, { employerMatch: null }));
    expect(json.data.changed).toBe(true);
    expect(json.data.profile.employerMatch).toBeNull();
  });

  it("serializes concurrent saves into consecutive versions", async () => {
    const user = await signedInUser();
    const [a, b] = await Promise.all([
      put(validBody(null, { inflationPct: 2 })),
      put(validBody(null, { inflationPct: 4 })),
    ]);

    expect([a.res.status, b.res.status]).toEqual([200, 200]);
    expect([a.json.data.profile.version, b.json.data.profile.version].sort()).toEqual([1, 2]);
    expect(await versionCount(user.id)).toBe(2);
  });
});

describe("PUT /api/financial-profile — contribution targets", () => {
  it("rejects a target on another user's account", async () => {
    const other = await seedUser();
    userIds.push(other.id);
    const theirs = await seedAccount(other.id);
    const me = await signedInUser();

    const { res, json } = await put(validBody(theirs.id));
    expect(res.status).toBe(400);
    expect(json.error.fieldErrors["contributionTargets.0.accountId"]).toBe("Choose one of your accounts.");
    expect(await versionCount(me.id)).toBe(0);
  });

  it("rejects a target on a debt account", async () => {
    const user = await signedInUser();
    const card = await seedAccount(user.id, "credit_card");
    const { res, json } = await put(validBody(card.id));
    expect(res.status).toBe(400);
    expect(json.error.fieldErrors["contributionTargets.0.accountId"]).toMatch(/cash, investment, or retirement/);
  });

  it("accepts a target on an archived account the user owns", async () => {
    const user = await signedInUser();
    const archived = await seedAccount(user.id, "brokerage", new Date());
    const { res, json } = await put(validBody(archived.id));
    expect(res.status).toBe(200);
    expect(json.data.profile.contributionTargets).toEqual([
      { accountId: archived.id, annualAmount: 23000 },
    ]);
  });
});

describe("PUT /api/financial-profile — isolation", () => {
  it("one user's save never touches another user's versions", async () => {
    const a = await signedInUser();
    await put(validBody(null));

    const b = await signedInUser();
    await put(validBody(null, { inflationPct: 6 }));
    await put(validBody(null, { inflationPct: 7 }));

    expect(await versionCount(a.id)).toBe(1);
    expect(await versionCount(b.id)).toBe(2);
    expect((await getCurrentFinancialProfile(a.id))?.inflationPct).toBe(2.5);
  });
});

describe("saveFinancialProfile / getCurrentFinancialProfile", () => {
  async function bareUser() {
    const user = await seedUser();
    userIds.push(user.id);
    return user;
  }

  it("returns null before the first save", async () => {
    const user = await bareUser();
    expect(await getCurrentFinancialProfile(user.id)).toBeNull();
  });

  it("returns the highest version", async () => {
    const user = await bareUser();
    await saveFinancialProfile(user.id, validBody(null) as FinancialProfileInput);
    await saveFinancialProfile(user.id, validBody(null, { inflationPct: 3 }) as FinancialProfileInput);
    const current = await getCurrentFinancialProfile(user.id);
    expect(current?.version).toBe(2);
    expect(current?.inflationPct).toBe(3);
  });

  it("treats the derived current age as unchanged", async () => {
    const user = await bareUser();
    const savedAt = new Date("2026-10-31T12:00:00.000Z");
    await saveFinancialProfile(user.id, validBody(null) as FinancialProfileInput, savedAt);

    const aYearLater = new Date("2027-11-01T12:00:00.000Z");
    const result = await saveFinancialProfile(
      user.id,
      validBody(null, { age: 36 }) as FinancialProfileInput,
      aYearLater,
    );
    expect(result.changed).toBe(false);
    expect(result.profile.version).toBe(1);
  });

  it("re-anchors the age when the user corrects it", async () => {
    const user = await bareUser();
    const savedAt = new Date("2026-10-31T12:00:00.000Z");
    await saveFinancialProfile(user.id, validBody(null) as FinancialProfileInput, savedAt);

    const later = new Date("2027-03-01T12:00:00.000Z");
    const result = await saveFinancialProfile(
      user.id,
      validBody(null, { age: 36 }) as FinancialProfileInput,
      later,
    );
    expect(result.changed).toBe(true);
    expect(result.profile).toMatchObject({
      version: 2,
      ageAtEffective: 36,
      effectiveAt: later.toISOString(),
    });
  });
});
