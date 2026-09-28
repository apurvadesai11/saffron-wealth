import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/server";
import { validateCsrfFromRequest } from "@/lib/auth/csrf";
import { rateLimit } from "@/lib/auth/rate-limit";
import type { SessionWithUser } from "@/lib/auth/sessions";
import { err, internalError } from "./errors";

/**
 * The preamble every session-gated JSON route ran: resolve the session, reject
 * without one, optionally check CSRF, optionally check a user-keyed rate
 * limit, and wrap the whole thing in the try/catch that returns the 500
 * envelope.
 *
 * Scope, deliberately: this covers the routes whose gate sequence and gate
 * messages are identical — /api/profile/*, /api/transactions/*,
 * /api/accounts/*, /api/budgets, /api/auth/logout-all. It does NOT cover the
 * unauthenticated auth routes (login, register, the password-reset pair,
 * email-change/confirm). Those run an IP-keyed limiter *before* CSRF, use
 * their own 429 message, and carry per-route enumeration and uniform-timing
 * defenses in the same preamble. Folding them in here would take options for
 * gate order and for every message, which is a configuration language for a
 * six-line preamble — and it would hide reasoning that is load-bearing for
 * security. They stay explicit. Likewise /api/auth/me (whose 401 message has
 * no trailing period), /api/auth/logout (no session required),
 * /api/auth/oauth/* (redirects, not JSON) and /api/cron/* (bearer token).
 */
export interface ApiHandlerContext<C = undefined> {
  req: NextRequest;
  // Non-null: the wrapper has already returned 401 if there was no session.
  session: SessionWithUser;
  // A dynamic route's second argument, e.g. `{ params: Promise<{ id }> }`.
  routeContext: C;
}

/**
 * Next.js type-checks each exported handler against the shape it will call it
 * with, and the two shapes differ: a route with dynamic segments is called
 * with `(req, { params })` and one without is called with `(req)`. A single
 * signature with an optional second parameter satisfies neither — it is
 * rejected as `RouteParams | undefined` for the dynamic case. So the arity is
 * derived from whether a route context type was supplied.
 */
type RouteArgs<C> = C extends undefined
  ? [req: NextRequest]
  : [req: NextRequest, routeContext: C];

export interface ApiHandlerOptions {
  // Prefix for the unhandled-error log line, e.g. "api/accounts/[id] PATCH".
  logLabel: string;
  csrf?: boolean;
  // Rate-limit bucket. Always keyed by the session user id — these routes are
  // authenticated, the user id is whose resources are being spent, and IP is
  // client-supplied.
  rateLimit?: string;
}

export function withApiHandler<C = undefined>(
  options: ApiHandlerOptions,
  handler: (ctx: ApiHandlerContext<C>) => Promise<NextResponse>,
): (...args: RouteArgs<C>) => Promise<NextResponse> {
  const wrapped = async function wrapped(
    req: NextRequest,
    routeContext?: C,
  ): Promise<NextResponse> {
    try {
      // Gate order is the order the routes had, and the order
      // app/api/auth/__tests__/route-rate-limits.test.ts depends on: an
      // unauthenticated caller gets 401 without CSRF being consulted, and a
      // bad token gets 403 without spending a rate-limit token.
      const session = await getSession();
      if (!session) return err("UNAUTHENTICATED", "Not signed in.", 401);

      if (options.csrf && !validateCsrfFromRequest(req)) {
        return err("CSRF_FAILED", "Invalid request.", 403);
      }

      if (options.rateLimit) {
        const rl = await rateLimit(options.rateLimit, session.user.id);
        if (!rl.ok) {
          return err("RATE_LIMITED", "Too many requests. Try again shortly.", 429);
        }
      }

      return await handler({ req, session, routeContext: routeContext as C });
    } catch (e) {
      console.error(`[${options.logLabel}] unhandled error`, e);
      return internalError();
    }
  };

  // The one cast: `wrapped` accepts the context optionally so it can serve
  // both arities, and RouteArgs is what tells Next.js which arity this
  // particular route has.
  return wrapped as (...args: RouteArgs<C>) => Promise<NextResponse>;
}
