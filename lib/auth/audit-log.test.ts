// recordAuthEvent is load-bearing for a property stated in CLAUDE.md's house
// style: "Errors never crash auth flows. Audit-log failures must not block the
// user-visible response." Nothing pinned it, so a refactor that let the write
// throw would silently turn a logged-in user into a 500.
import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { authEvent: { create: mocks.create } } }));

import { recordAuthEvent } from "./audit-log";

beforeEach(() => {
  mocks.create.mockReset().mockResolvedValue({});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("recordAuthEvent", () => {
  it("writes the event through to Prisma", async () => {
    await recordAuthEvent({
      type: "login_success",
      userId: "u1",
      ipAddress: "203.0.113.7",
      userAgent: "Mozilla/5.0",
      metadata: { emailNormalized: "a@b.com" },
    });

    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        type: "login_success",
        userId: "u1",
        ipAddress: "203.0.113.7",
        userAgent: "Mozilla/5.0",
        metadata: { emailNormalized: "a@b.com" },
      },
    });
  });

  // Every optional field becomes an explicit null rather than being omitted,
  // so a row is never partially absent and a reader never has to distinguish
  // "not recorded" from "not present".
  it("normalizes every omitted field to null", async () => {
    await recordAuthEvent({ type: "session_revoked" });

    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        type: "session_revoked",
        userId: null,
        ipAddress: null,
        userAgent: null,
        metadata: null,
      },
    });
  });

  it("treats an explicit undefined the same as an omission", async () => {
    await recordAuthEvent({ type: "session_revoked", userId: undefined, ipAddress: undefined });

    const { data } = mocks.create.mock.calls[0][0];
    expect(data.userId).toBeNull();
    expect(data.ipAddress).toBeNull();
  });

  // The whole point of the module. A dead database, a constraint violation, a
  // connection-pool timeout — none of it may reach the caller, because the
  // caller is in the middle of signing someone in.
  it("swallows a write failure instead of throwing", async () => {
    mocks.create.mockRejectedValue(new Error("connection terminated"));

    await expect(recordAuthEvent({ type: "login_failure" })).resolves.toBeUndefined();
  });

  it("logs the failure, with the event type, so it is not lost silently", async () => {
    mocks.create.mockRejectedValue(new Error("connection terminated"));

    await recordAuthEvent({ type: "login_failure" });

    expect(console.error).toHaveBeenCalledWith(
      "[audit-log] failed to record event",
      "login_failure",
      expect.any(Error),
    );
  });

  it("swallows a synchronous throw as well as a rejected promise", async () => {
    mocks.create.mockImplementation(() => {
      throw new Error("client not initialized");
    });

    await expect(recordAuthEvent({ type: "login_failure" })).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});
