/**
 * Simple sliding-window rate limiter kept in server memory.
 *
 * Honest limitation: on Vercel each server instance has its own memory, so this
 * is a best-effort guard against accidents and casual abuse, not a hard global
 * limit. The real protection for the YouTube quota is that search requires
 * sign-in. For a strict limit, use a shared store such as Upstash Redis.
 */
export interface RateLimiter {
  check(key: string, now?: number): { ok: true } | { ok: false; retryAfterSeconds: number };
}

export function createRateLimiter(limit: number, windowMs: number, maxKeys = 5000): RateLimiter {
  const hits = new Map<string, number[]>();

  return {
    check(key, now = Date.now()) {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        const retryAfterSeconds = Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000));
        return { ok: false, retryAfterSeconds };
      }
      recent.push(now);
      hits.delete(key);
      hits.set(key, recent); // keeps most recently used keys at the end
      if (hits.size > maxKeys) {
        const oldest = hits.keys().next().value;
        if (oldest !== undefined) hits.delete(oldest);
      }
      return { ok: true };
    },
  };
}
