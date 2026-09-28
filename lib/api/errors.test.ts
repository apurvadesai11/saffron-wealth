import { describe, it, expect } from "vitest";
import { err, internalError } from "./errors";

// 14 routes carried their own copy of err() in four different shapes: three
// took (code, message, status), six added a positional `fieldErrors`, and
// login added a positional `retryAfterSeconds`. This is the one canonical
// version. The tests pin the wire format, because the client reads
// data.error.message and data.error.fieldErrors directly and the E2E specs
// assert on user-visible messages.
describe("err", () => {
  it("returns the ok:false envelope with the given status", async () => {
    const res = err("UNAUTHENTICATED", "Not signed in.", 401);

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: { code: "UNAUTHENTICATED", message: "Not signed in." },
    });
  });

  // The absence of the key matters, not just its falsiness: the client
  // branches on whether fieldErrors is present.
  it("omits fieldErrors and retryAfterSeconds entirely when not supplied", async () => {
    const body = await err("BAD_REQUEST", "Invalid body.", 400).json();

    expect(Object.keys(body.error)).toEqual(["code", "message"]);
  });

  it("includes fieldErrors when supplied", async () => {
    const res = err("VALIDATION_FAILED", "Please correct the errors and try again.", 400, {
      fieldErrors: { email: "Enter a valid email address." },
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "Please correct the errors and try again.",
        fieldErrors: { email: "Enter a valid email address." },
      },
    });
  });

  it("includes retryAfterSeconds when supplied, including zero", async () => {
    const body = await err("RATE_LIMITED", "Too many attempts.", 429, {
      retryAfterSeconds: 0,
    }).json();

    expect(body.error.retryAfterSeconds).toBe(0);
  });

  it("carries both extras at once", async () => {
    const body = await err("NOPE", "No.", 400, {
      fieldErrors: { a: "b" },
      retryAfterSeconds: 30,
    }).json();

    expect(body.error).toEqual({
      code: "NOPE",
      message: "No.",
      fieldErrors: { a: "b" },
      retryAfterSeconds: 30,
    });
  });
});

describe("internalError", () => {
  // Byte-for-byte what all 22 routes' catch blocks returned inline.
  it("is the 500 envelope every route's catch block returned", async () => {
    const res = internalError();

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." },
    });
  });
});
