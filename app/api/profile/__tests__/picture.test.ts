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

// Mock storage module: avoid Vercel Blob / local-disk writes during tests AND
// avoid sharp's native bindings (which can behave differently across runners —
// see Linux CI). validateImageBuffer stays real so the magic-byte
// rejection path is still exercised end-to-end.
vi.mock("@/lib/auth/picture-storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/picture-storage")>(
    "@/lib/auth/picture-storage",
  );
  return {
    ...actual,
    processAvatarImage: vi.fn(async (b: Buffer) => b),
    uploadAvatar: vi.fn(async () => "https://example.test/uploads/fake.webp"),
  };
});

import { POST } from "../picture/route";
import { seedUser, seedSession, makeRequest, cleanupUser } from "./helpers";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "@/lib/auth/csrf-shared";
import { NextRequest } from "next/server";

// Tiny but real PNG header bytes — enough for file-type sniffing to accept,
// and small enough to not blow up the test runtime. Sharp will accept a
// 1×1 PNG.
const ONE_PX_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

let userId: string;
beforeEach(() => { mocks.sessionToken = null; });
afterEach(async () => {
  if (userId) await cleanupUser(userId);
  userId = "";
});

function multipartRequest(opts: {
  csrf?: string;
  file?: Buffer;
  filename?: string;
  fileMime?: string;
  withoutFile?: boolean;
  rawContentLength?: number;
}): NextRequest {
  const form = new FormData();
  if (!opts.withoutFile && opts.file) {
    // Wrap as Uint8Array — Buffer is ArrayBufferLike-typed which strict TS
    // refuses to accept as a BlobPart in Node 20+ lib defs.
    const blob = new Blob([new Uint8Array(opts.file)], { type: opts.fileMime ?? "image/png" });
    form.set("file", blob, opts.filename ?? "avatar.png");
  }
  const headers = new Headers();
  if (opts.csrf) headers.set(CSRF_HEADER_NAME, opts.csrf);
  if (opts.rawContentLength !== undefined) {
    headers.set("content-length", String(opts.rawContentLength));
  }
  const req = new NextRequest("http://localhost/api/profile/picture", {
    method: "POST",
    headers,
    body: form,
  });
  if (opts.csrf) req.cookies.set(CSRF_COOKIE_NAME, opts.csrf);
  return req;
}

describe("POST /api/profile/picture", () => {
  it("returns 401 when not signed in", async () => {
    const req = multipartRequest({ csrf: "csrf", file: ONE_PX_PNG });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 403 when CSRF is missing", async () => {
    const user = await seedUser();
    userId = user.id;
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const req = multipartRequest({ file: ONE_PX_PNG });
    const res = await POST(req);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("CSRF_FAILED");
  });

  // Note: the route's content-length early-reject is exercised by buffer-size
  // checks inside validateImageBuffer (covered in lib/auth/picture-storage.test.ts).
  // `content-length` is a forbidden header in the Fetch spec, so we can't set
  // it on a constructed Request without sending an actual oversized body.

  it("returns 400 when the body is not multipart", async () => {
    const user = await seedUser();
    userId = user.id;
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    // Use makeRequest with JSON to force a non-multipart content-type. The
    // route will call req.formData() which throws on non-multipart input.
    const req = makeRequest({
      method: "POST",
      url: "http://localhost/api/profile/picture",
      csrfToken: "csrf",
      body: { not: "multipart" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("BAD_REQUEST");
  });

  it("returns 400 when multipart body has no 'file' field", async () => {
    const user = await seedUser();
    userId = user.id;
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const req = multipartRequest({ csrf: "csrf", withoutFile: true });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("BAD_REQUEST");
  });

  it("returns 400 INVALID_IMAGE when the uploaded buffer isn't a real image", async () => {
    const user = await seedUser();
    userId = user.id;
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const garbage = Buffer.from("definitely not an image", "utf8");
    const req = multipartRequest({
      csrf: "csrf",
      file: garbage,
      filename: "evil.png",
      fileMime: "image/png",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_IMAGE");
  });

  it("uploads a valid image and persists the returned URL on the user", async () => {
    const user = await seedUser();
    userId = user.id;
    const { rawToken } = await seedSession(user.id);
    mocks.sessionToken = rawToken;

    const req = multipartRequest({ csrf: "csrf", file: ONE_PX_PNG });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.profilePicture).toBe("https://example.test/uploads/fake.webp");

    const refreshed = await prisma.user.findUnique({ where: { id: user.id } });
    expect(refreshed?.profilePicture).toBe("https://example.test/uploads/fake.webp");
  });
});
