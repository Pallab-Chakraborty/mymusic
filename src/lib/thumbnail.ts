import type { Track } from "@/lib/types";

const ALLOWED_HOSTS = new Set(["i.ytimg.com", "img.youtube.com"]);

/** The standard thumbnail address YouTube uses for a video id. */
export function thumbnailForId(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

/**
 * Thumbnail to display. Only YouTube's own image hosts are used, so a saved or
 * imported track can never make the browser contact some other website.
 */
export function thumbnailFor(track: Pick<Track, "videoId" | "thumbnailUrl">): string {
  if (track.thumbnailUrl) {
    try {
      const u = new URL(track.thumbnailUrl);
      if (u.protocol === "https:" && ALLOWED_HOSTS.has(u.hostname)) return track.thumbnailUrl;
    } catch {
      // fall through to the default
    }
  }
  return thumbnailForId(track.videoId);
}
