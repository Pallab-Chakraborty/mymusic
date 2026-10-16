import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createRateLimiter } from "@/lib/rateLimit";
import { isSameOrigin } from "@/lib/csrf";
import { MAX_IMPORT_BYTES, parseExport } from "@/lib/exportImport";

export const dynamic = "force-dynamic";

const limiter = createRateLimiter(10, 60_000);

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", ...headers } });
}

/**
 * Import playlists from a MyMusic JSON backup.
 * The file is fully validated here on the server, then each playlist is saved
 * in one all-or-nothing database call, running as the signed-in user (so the
 * database's Row Level Security still applies).
 */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return json({ error: "Request blocked." }, 403);
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
    return json({ error: "Expected a JSON file." }, 415);
  }

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_IMPORT_BYTES) return json({ error: "That file is too large (limit 2 MB)." }, 413);

  let userId: string | undefined;
  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    userId = data?.claims?.sub;
  } catch {
    return json({ error: "The service is temporarily unavailable." }, 503);
  }
  if (!userId) return json({ error: "Please sign in." }, 401);

  const limit = limiter.check(userId);
  if (!limit.ok) {
    return json({ error: "Too many imports. Please wait a moment." }, 429, {
      "Retry-After": String(limit.retryAfterSeconds),
    });
  }

  const text = await request.text();
  if (text.length > MAX_IMPORT_BYTES) return json({ error: "That file is too large (limit 2 MB)." }, 413);

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return json({ error: "That file isn't valid JSON." }, 400);
  }

  const parsed = parseExport(raw);
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  const imported: { id: string; name: string; tracks: number }[] = [];
  const failed: { name: string; error: string }[] = [];

  for (const playlist of parsed.playlists) {
    const id = crypto.randomUUID();
    const { error } = await supabase.rpc("import_playlist", {
      p_id: id,
      p_name: playlist.name,
      p_description: playlist.description,
      p_tracks: playlist.tracks.map((t) => ({
        video_id: t.videoId,
        title: t.title,
        channel_title: t.channelTitle,
        thumbnail_url: t.thumbnailUrl,
        duration_seconds: t.durationSeconds,
      })),
    });
    if (error) {
      console.error(`[import] playlist failed (code ${error.code ?? "unknown"})`);
      failed.push({ name: playlist.name, error: "Could not be saved." });
    } else {
      imported.push({ id, name: playlist.name, tracks: playlist.tracks.length });
    }
  }

  // Only report success for playlists the database actually confirmed.
  return json({ imported, failed }, failed.length > 0 && imported.length === 0 ? 500 : 200);
}
