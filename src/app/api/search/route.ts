import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createRateLimiter } from "@/lib/rateLimit";
import { searchYouTube, YouTubeError, YOUTUBE_ERROR_MESSAGES } from "@/lib/youtube/search";
import type { Track } from "@/lib/types";

// Runs on the server only. The API key never reaches the browser.
export const dynamic = "force-dynamic";

const querySchema = z.object({ q: z.string().trim().min(1).max(100) });

const limiter = createRateLimiter(20, 60_000);

// Search costs 100 quota units out of a default 10,000 per day, so repeat
// searches are served from memory for a few minutes.
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 200;
const cache = new Map<string, { at: number; results: Track[] }>();

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", ...headers } });
}

function fail(code: keyof typeof YOUTUBE_ERROR_MESSAGES, status: number, headers?: Record<string, string>) {
  return json({ error: code, message: YOUTUBE_ERROR_MESSAGES[code] }, status, headers);
}

export async function GET(request: NextRequest) {
  let userId: string | undefined;
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    userId = data?.claims?.sub;
  } catch {
    return json({ error: "unavailable", message: YOUTUBE_ERROR_MESSAGES.unavailable }, 503);
  }
  if (!userId) return fail("unauthorized", 401);

  const parsed = querySchema.safeParse({ q: request.nextUrl.searchParams.get("q") ?? "" });
  if (!parsed.success) return fail("bad_query", 400);
  const q = parsed.data.q;

  const limit = limiter.check(userId);
  if (!limit.ok) return fail("rate_limited", 429, { "Retry-After": String(limit.retryAfterSeconds) });

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return fail("not_configured", 503);

  const cacheKey = q.toLowerCase();
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return json({ results: hit.results, cached: true });

  try {
    const results = await searchYouTube(q, apiKey);
    cache.delete(cacheKey);
    cache.set(cacheKey, { at: Date.now(), results });
    if (cache.size > CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return json({ results });
  } catch (err) {
    if (err instanceof YouTubeError) {
      // Log only our own short code, never the request or the key.
      console.error(`[search] youtube error: ${err.code}`);
      const status = err.code === "quota_exceeded" ? 429 : err.code === "network" ? 502 : 503;
      return fail(err.code, status);
    }
    console.error("[search] unexpected error");
    return fail("unavailable", 500);
  }
}
