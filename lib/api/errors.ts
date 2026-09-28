import { NextResponse } from "next/server";

/**
 * The error half of every API response in this app.
 *
 * Fourteen routes each declared their own `err()` and ten their own
 * `ErrorBody`, in four different shapes — which meant a new error field, or a
 * change to the envelope, was a dozen-file edit with no way to tell whether
 * one had been missed. This is the single copy.
 *
 * The success half stays inline per route: `{ ok: true, data: ... }` (or, for
 * the two CSV imports, `{ ok: true, summary, ... }`). Those payloads are
 * route-specific and there is nothing to share.
 */
export interface ErrorBody {
  ok: false;
  error: {
    code: string;
    message: string;
    // Per-field messages for a form. The client branches on this key being
    // present, so it must be absent rather than empty when there are none.
    fieldErrors?: Record<string, string>;
    // Set by the rate-limited and backed-off auth paths so the client can say
    // how long to wait instead of guessing.
    retryAfterSeconds?: number;
  };
}

export interface ErrorExtras {
  fieldErrors?: Record<string, string>;
  retryAfterSeconds?: number;
}

export function err(
  code: string,
  message: string,
  status: number,
  extras?: ErrorExtras,
): NextResponse<ErrorBody> {
  return NextResponse.json<ErrorBody>(
    {
      ok: false,
      error: {
        code,
        message,
        ...(extras?.fieldErrors ? { fieldErrors: extras.fieldErrors } : {}),
        ...(extras?.retryAfterSeconds !== undefined
          ? { retryAfterSeconds: extras.retryAfterSeconds }
          : {}),
      },
    },
    { status },
  );
}

/**
 * The 500 every route's catch block returned verbatim. Deliberately says
 * nothing about what failed — the detail goes to the server log, not to the
 * caller.
 */
export function internalError(): NextResponse<ErrorBody> {
  return err("INTERNAL_ERROR", "An unexpected error occurred.", 500);
}
