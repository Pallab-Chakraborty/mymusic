import type { Track } from "./types";

export type SortKey =
  "manual" | "title-asc" | "title-desc" | "artist-asc" | "artist-desc" | "length-desc" | "length-asc";

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "manual", label: "My order" },
  { key: "title-asc", label: "Title A → Z" },
  { key: "title-desc", label: "Title Z → A" },
  { key: "artist-asc", label: "Artist A → Z" },
  { key: "artist-desc", label: "Artist Z → A" },
  { key: "length-desc", label: "Longest first" },
  { key: "length-asc", label: "Shortest first" },
];

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/** A sorted copy. The sort is stable: songs that tie keep the order you gave them. "manual" returns the list as is. */
export function sortTracks(tracks: readonly Track[], key: SortKey): Track[] {
  if (key === "manual") return [...tracks];
  const indexed = tracks.map((t, i) => ({ t, i }));
  const dir = key.endsWith("desc") ? -1 : 1;
  indexed.sort((a, b) => {
    let c = 0;
    if (key.startsWith("title")) c = collator.compare(a.t.title, b.t.title) * dir;
    else if (key.startsWith("artist")) {
      c = collator.compare(a.t.channelTitle, b.t.channelTitle) * dir || collator.compare(a.t.title, b.t.title);
    } else {
      // Songs without a known length always go last.
      const x = a.t.durationSeconds;
      const y = b.t.durationSeconds;
      if (x == null && y == null) c = 0;
      else if (x == null) return 1;
      else if (y == null) return -1;
      else c = (x - y) * dir;
    }
    return c || a.i - b.i;
  });
  return indexed.map((x) => x.t);
}

/** Keep songs whose title or artist contains every word typed (any case). */
export function filterTracks(tracks: readonly Track[], query: string): Track[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...tracks];
  return tracks.filter((t) => {
    const hay = `${t.title} ${t.channelTitle}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
