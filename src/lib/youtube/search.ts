import type { Track } from "@/lib/types";
import { thumbnailForId } from "@/lib/thumbnail";

export type YouTubeErrorCode = "quota_exceeded" | "invalid_key" | "network" | "unavailable";

export class YouTubeError extends Error {
  constructor(
    public readonly code: YouTubeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "YouTubeError";
  }
}

export const YOUTUBE_ERROR_MESSAGES: Record<
  YouTubeErrorCode | "not_configured" | "rate_limited" | "bad_query" | "unauthorized",
  string
> = {
  quota_exceeded:
    "YouTube search has reached its daily limit. Your saved library still works. Please try searching again tomorrow.",
  invalid_key: "Search isn't set up correctly on the server (the YouTube API key was rejected).",
  network: "Couldn't reach YouTube. Check your connection and try again.",
  unavailable: "YouTube search is temporarily unavailable. Please try again in a moment.",
  not_configured: "Search isn't set up yet: the server has no YouTube API key.",
  rate_limited: "You're searching very quickly. Please wait a moment and try again.",
  bad_query: "Type something to search for (up to 100 characters).",
  unauthorized: "Please sign in to search.",
};

/** "PT1H2M3S" -> 3723. Live streams ("P0D") and anything unparseable -> null. */
export function parseIsoDuration(iso: string | undefined | null): number | null {
  if (!iso) return null;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso);
  if (!m) return null;
  const [, d, h, min, s] = m;
  const total = +(d ?? 0) * 86400 + +(h ?? 0) * 3600 + +(min ?? 0) * 60 + +(s ?? 0);
  return total > 0 ? total : null;
}

const OFFICIAL_API = "https://www.googleapis.com/youtube/v3";
// Test-only escape hatch: the automated tests point this at a local fake. It does
// nothing unless BOTH variables are set, so a normal deployment always talks to Google.
const API =
  process.env.E2E_FAKE_SERVICES === "1" && process.env.YOUTUBE_API_BASE_URL
    ? process.env.YOUTUBE_API_BASE_URL
    : OFFICIAL_API;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

interface GoogleErrorBody {
  error?: { code?: number; message?: string; errors?: { reason?: string }[]; status?: string };
}

function classifyGoogleError(status: number, body: GoogleErrorBody | null): YouTubeError {
  const reasons = (body?.error?.errors ?? []).map((e) => e.reason ?? "");
  const message = body?.error?.message ?? "";
  if (reasons.some((r) => /quotaExceeded|dailyLimitExceeded|rateLimitExceeded|userRateLimitExceeded/.test(r))) {
    return new YouTubeError("quota_exceeded", "quota");
  }
  if (
    reasons.some((r) => /keyInvalid|accessNotConfigured|ipRefererBlocked|keyExpired|API_KEY/i.test(r)) ||
    /api key|API_KEY_INVALID|has not been used|is disabled/i.test(message) ||
    body?.error?.status === "PERMISSION_DENIED"
  ) {
    return new YouTubeError("invalid_key", "key");
  }
  if (status === 429) return new YouTubeError("quota_exceeded", "rate");
  return new YouTubeError("unavailable", `status ${status}`);
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

async function callApi<T>(path: string, params: Record<string, string>, apiKey: string, fetcher: Fetcher): Promise<T> {
  const url = `${API}/${path}?${new URLSearchParams({ ...params, key: apiKey }).toString()}`;
  let res: Response;
  try {
    res = await fetcher(url, { signal: AbortSignal.timeout(8000), cache: "no-store" });
  } catch {
    // Deliberately drop the original error: it can contain the request URL (with the key).
    throw new YouTubeError("network", "network");
  }
  if (!res.ok) {
    let body: GoogleErrorBody | null = null;
    try {
      body = (await res.json()) as GoogleErrorBody;
    } catch {
      body = null;
    }
    throw classifyGoogleError(res.status, body);
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new YouTubeError("unavailable", "bad response");
  }
}

interface SearchResponse {
  items?: { id?: { videoId?: string } }[];
}
interface VideosResponse {
  items?: {
    id?: string;
    snippet?: { title?: string; channelTitle?: string };
    contentDetails?: { duration?: string };
    status?: { embeddable?: boolean; privacyStatus?: string };
  }[];
}

/**
 * Search public YouTube videos with the official Data API (search.list + videos.list).
 * Only videos that can be embedded are returned, so "play" is expected to work.
 * Quota cost: 100 units for the search + 1 for the details.
 */
export async function searchYouTube(
  query: string,
  apiKey: string,
  fetcher: Fetcher = fetch,
  maxResults = 15,
): Promise<Track[]> {
  const search = await callApi<SearchResponse>(
    "search",
    {
      part: "snippet",
      type: "video",
      videoEmbeddable: "true",
      maxResults: String(maxResults),
      q: query,
      fields: "items(id/videoId)",
    },
    apiKey,
    fetcher,
  );

  const ids = [
    ...new Set((search.items ?? []).map((i) => i.id?.videoId).filter((id): id is string => !!id && VIDEO_ID.test(id))),
  ];
  if (ids.length === 0) return [];

  const videos = await callApi<VideosResponse>(
    "videos",
    {
      part: "snippet,contentDetails,status",
      id: ids.join(","),
      fields: "items(id,snippet(title,channelTitle),contentDetails/duration,status(embeddable,privacyStatus))",
    },
    apiKey,
    fetcher,
  );

  const byId = new Map((videos.items ?? []).map((v) => [v.id, v]));
  const tracks: Track[] = [];
  for (const id of ids) {
    const v = byId.get(id);
    if (!v?.snippet?.title) continue;
    if (v.status?.embeddable !== true || v.status?.privacyStatus !== "public") continue;
    tracks.push({
      videoId: id,
      title: v.snippet.title.slice(0, 500),
      channelTitle: (v.snippet.channelTitle ?? "").slice(0, 300),
      thumbnailUrl: thumbnailForId(id),
      durationSeconds: parseIsoDuration(v.contentDetails?.duration),
    });
  }
  return tracks;
}
