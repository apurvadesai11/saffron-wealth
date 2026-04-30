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

const WINDOW_MS = 60_000;
const LIMIT = 5;

class MemoryRateLimiter implements RateLimiter {
  private hits = new Map<string, number[]>();

  async check(key: string): Promise<RateLimitResult> {
    const now = Date.now();
    const cutoff = now - WINDOW_MS;
    const arr = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    arr.push(now);
    this.hits.set(key, arr);
    return {
      ok: arr.length <= LIMIT,
      remaining: Math.max(0, LIMIT - arr.length),
      reset: now + WINDOW_MS,
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

  constructor() {
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
        limiter: Ratelimit.slidingWindow(LIMIT, "60 s"),
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

let limiter: RateLimiter | null = null;

function getLimiter(): RateLimiter {
  if (limiter) return limiter;
  limiter =
    UPSTASH_URL && UPSTASH_TOKEN
      ? new UpstashRateLimiter()
      : new MemoryRateLimiter();
  return limiter;
}

export async function rateLimit(
  scope: string,
  identifier: string,
): Promise<RateLimitResult> {
  return getLimiter().check(`${scope}:${identifier}`);
}

// Used in tests to reset state between cases when running under memory mode.
export function __resetRateLimiterForTests(): void {
  limiter = null;
}
