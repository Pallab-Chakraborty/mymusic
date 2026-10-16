import { z } from "zod";
import type { Playlist, Track } from "@/lib/types";
import { thumbnailForId } from "@/lib/thumbnail";

export const EXPORT_FORMAT = "mymusic-playlists";
export const EXPORT_VERSION = 1;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_PLAYLISTS = 100;
export const MAX_TRACKS_PER_PLAYLIST = 5000;

const trackSchema = z.object({
  videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/, "Not a valid YouTube video id"),
  title: z.string().trim().min(1).max(500),
  channelTitle: z.string().max(300).default(""),
  durationSeconds: z.number().int().min(0).max(1_000_000).nullable().optional(),
  // Accepted for compatibility but never trusted: thumbnails are rebuilt from the video id.
  thumbnailUrl: z.string().nullable().optional(),
});

const playlistSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).nullable().optional(),
  tracks: z.array(trackSchema).max(MAX_TRACKS_PER_PLAYLIST),
});

export const exportSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(EXPORT_VERSION),
  exportedAt: z.string().optional(),
  playlists: z.array(playlistSchema).min(1).max(MAX_IMPORT_PLAYLISTS),
});

export type ExportFile = z.infer<typeof exportSchema>;

export interface CleanPlaylist {
  name: string;
  description: string | null;
  tracks: Track[];
}

/** Build the downloadable backup (JSON). Includes every active playlist given. */
export function buildExport(playlists: Playlist[], now = new Date()): string {
  const file = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    playlists: playlists.map((p) => ({
      name: p.name,
      description: p.description,
      tracks: p.tracks.map((t) => ({
        videoId: t.videoId,
        title: t.title,
        channelTitle: t.channelTitle,
        durationSeconds: t.durationSeconds,
        thumbnailUrl: t.thumbnailUrl,
      })),
    })),
  };
  return JSON.stringify(file, null, 2);
}

export type ParseResult = { ok: true; playlists: CleanPlaylist[] } | { ok: false; error: string };

/** Check an uploaded file and turn it into clean playlists. Used by the server before anything is saved. */
export function parseExport(input: unknown): ParseResult {
  const parsed = exportSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue.path.length ? ` (at ${issue.path.join(" › ")})` : "";
    if (issue.path.length === 0 || issue.path[0] === "format" || issue.path[0] === "version") {
      return { ok: false, error: "This doesn't look like a MyMusic backup file." };
    }
    return { ok: false, error: `The file has a problem${where}: ${issue.message}` };
  }

  const playlists = parsed.data.playlists.map((p) => {
    const seen = new Set<string>();
    const tracks: Track[] = [];
    for (const t of p.tracks) {
      if (seen.has(t.videoId)) continue;
      seen.add(t.videoId);
      tracks.push({
        videoId: t.videoId,
        title: t.title,
        channelTitle: t.channelTitle,
        thumbnailUrl: thumbnailForId(t.videoId),
        durationSeconds: t.durationSeconds ?? null,
      });
    }
    return { name: p.name, description: p.description ?? null, tracks };
  });
  return { ok: true, playlists };
}

const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

/**
 * Export as an M3U8 playlist.
 *  - #EXTINF lines hold length and "channel - title" (standard extended M3U).
 *  - The URL line is the normal YouTube watch address, so players that open web links can use it.
 *  - A "#MYMUSIC:videoId=..." comment line precedes each entry so MyMusic keeps the exact video id.
 *    Other programs ignore unknown comment lines.
 */
export function buildM3u(playlist: Pick<Playlist, "name" | "tracks">): string {
  const lines = ["#EXTM3U", `#PLAYLIST:${oneLine(playlist.name)}`];
  for (const t of playlist.tracks) {
    const secs = t.durationSeconds ?? -1;
    const label = t.channelTitle ? `${oneLine(t.channelTitle)} - ${oneLine(t.title)}` : oneLine(t.title);
    lines.push(`#MYMUSIC:videoId=${t.videoId}`);
    lines.push(`#EXTINF:${secs},${label}`);
    lines.push(`https://www.youtube.com/watch?v=${t.videoId}`);
  }
  return lines.join("\n") + "\n";
}

export function safeFileName(name: string, ext: string): string {
  const base = name
    .replace(/[^\p{L}\p{N}\-_ ]+/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return `${base || "playlist"}.${ext}`;
}
