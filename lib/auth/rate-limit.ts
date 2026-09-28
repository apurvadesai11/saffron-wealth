// Sliding-window rate limiter with Upstash Redis (when configured) or an
// in-memory Map fallback for dev/single-instance deploys. Memory mode is
// unsafe across multiple serverless lambda instances — set the Upstash env
// vars before deploying to Vercel.

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  reset: number;
}

interface RateLimiter {
  check(key: string): Promise<RateLimitResult>;
}

export interface ScopeLimit {
  limit: number;
  windowMs: number;
}

/**
 * Per-scope limits.
 *
 * A single global 5-per-minute was simultaneously too tight and too loose: too
 * tight for a CSV import, where a legitimate preview-then-commit is two
 * requests and a couple of retries exhausts the bucket, and far too loose for
 * change-password, which runs an Argon2 verify against the CURRENT password
 * and is therefore a password oracle for anyone holding a stolen session.
 *
 * Costs that justify the expensive scopes:
 *   balance-history  20MB CSV buffered, ~34k rows, 30s interactive transaction
 *   import           10MB CSV, ~7.6k rows, 20s transaction
 *   picture          sharp decode + resize + WebP re-encode
 *   change-password  Argon2 verify
 */
const SCOPE_LIMITS: Record<string, ScopeLimit> = {
  // Pre-auth, keyed by IP.
  login: { limit: 5, windowMs: 60_000 },
  register: { limit: 5, windowMs: 60_000 },
  // Split: request and confirm shared one bucket, so five combined requests
  // exhausted both halves of the flow.
  "password-reset-request": { limit: 5, windowMs: 60_000 },
  "password-reset-confirm": { limit: 5, windowMs: 60_000 },
  "email-change-confirm": { limit: 5, windowMs: 60_000 },

  // Authenticated, keyed by user id.
  "change-password": { limit: 5, windowMs: 900_000 },
  import: { limit: 10, windowMs: 600_000 },
  picture: { limit: 10, windowMs: 600_000 },
};

// An unknown scope is a programming error, not a request to be unlimited.
const DEFAULT_LIMIT: ScopeLimit = { limit: 5, windowMs: 60_000 };

export function limitForScope(scope: string): ScopeLimit {
  return SCOPE_LIMITS[scope] ?? DEFAULT_LIMIT;
}

class MemoryRateLimiter implements RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(private readonly config: ScopeLimit) {}

  async check(key: string): Promise<RateLimitResult> {
    const now = Date.now();
    const cutoff = now - this.config.windowMs;
    const arr = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    arr.push(now);
    this.hits.set(key, arr);
    return {
      ok: arr.length <= this.config.limit,
      remaining: Math.max(0, this.config.limit - arr.length),
      reset: now + this.config.windowMs,
    };
  }
}

class UpstashRateLimiter implements RateLimiter {
  private impl: Promise<{
    limit: (key: string) => Promise<{
      success: boolean;
      remaining: number;
      reset: number;
    }>;
  }>;

  constructor(config: ScopeLimit) {
    this.impl = (async () => {
      const [{ Ratelimit }, { Redis }] = await Promise.all([
        import("@upstash/ratelimit"),
        import("@upstash/redis"),
      ]);
      const redis = new Redis({
        url: UPSTASH_URL!,
        token: UPSTASH_TOKEN!,
      });
      return new Ratelimit({
        redis,
        // The window is baked into the limiter at construction, which is why
        // instances are memoized per scope below rather than built per request.
        limiter: Ratelimit.slidingWindow(
          config.limit,
          `${Math.round(config.windowMs / 1000)} s` as `${number} s`,
        ),
        analytics: false,
        prefix: "sw_ratelimit",
      });
    })();
  }

  async check(key: string): Promise<RateLimitResult> {
    const r = await (await this.impl).limit(key);
    return { ok: r.success, remaining: r.remaining, reset: r.reset };
  }
}

// One limiter per scope, built once. Rebuilding per request would re-open the
// Redis client and, in memory mode, throw away the hit history that IS the
// rate limit.
const limiters = new Map<string, RateLimiter>();

function getLimiter(scope: string): RateLimiter {
  const existing = limiters.get(scope);
  if (existing) return existing;

  const config = limitForScope(scope);
  const created =
    UPSTASH_URL && UPSTASH_TOKEN
      ? new UpstashRateLimiter(config)
      : new MemoryRateLimiter(config);
  limiters.set(scope, created);
  return created;
}

/**
 * Consumes one unit from `scope`'s bucket for `identifier`.
 *
 * Pick the identifier deliberately. Authenticated routes should pass
 * `session.user.id`: it is the thing whose resources are being spent, and it
 * cannot be rotated by editing a header the way a client-supplied
 * X-Forwarded-For can (see lib/auth/request-info.ts). Only pre-auth routes,
 * which have no user id yet, should key by IP.
 */
export async function rateLimit(
  scope: string,
  identifier: string,
): Promise<RateLimitResult> {
  return getLimiter(scope).check(`${scope}:${identifier}`);
}

// Used in tests to reset state between cases when running under memory mode.
export function __resetRateLimiterForTests(): void {
  limiters.clear();
}
