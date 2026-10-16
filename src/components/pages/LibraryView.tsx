"use client";

import { useMemo, useState } from "react";
import { useLibrary } from "@/components/providers/LibraryProvider";
import { usePlayer } from "@/components/providers/PlayerProvider";
import { TrackRow } from "@/components/ui/TrackRow";
import { Button, EmptyState, PageHeader, SkeletonRows, inputClass } from "@/components/ui/primitives";
import { PlayIcon, ShuffleIcon } from "@/components/ui/icons";
import type { Track } from "@/lib/types";

interface LibraryTrack {
  track: Track;
  playlists: string[];
}

/** Every saved song, once, with the playlists it is in. Searching happens on this device, so it is instant. */
export function LibraryView() {
  const library = useLibrary();
  const player = usePlayer();
  const [filter, setFilter] = useState("");

  const all = useMemo<LibraryTrack[]>(() => {
    const byId = new Map<string, LibraryTrack>();
    for (const p of library.playlists) {
      for (const t of p.tracks) {
        const entry = byId.get(t.videoId);
        if (entry) entry.playlists.push(p.name);
        else byId.set(t.videoId, { track: t, playlists: [p.name] });
      }
    }
    return [...byId.values()].sort((a, b) =>
      a.track.title.localeCompare(b.track.title, undefined, { sensitivity: "base" }),
    );
  }, [library.playlists]);

  const shown = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return all;
    return all.filter(
      ({ track, playlists }) =>
        track.title.toLowerCase().includes(term) ||
        track.channelTitle.toLowerCase().includes(term) ||
        playlists.some((n) => n.toLowerCase().includes(term)),
    );
  }, [all, filter]);

  const tracks = shown.map((s) => s.track);

  function shufflePlay() {
    if (tracks.length === 0) return;
    if (!library.library.settings.shuffle) player.setShuffle(true);
    player.playQueue(tracks, Math.floor(Math.random() * tracks.length));
  }

  return (
    <>
      <PageHeader
        title="My Library"
        subtitle={
          library.loaded
            ? `${all.length} saved ${all.length === 1 ? "song" : "songs"} across ${library.playlists.length} playlists`
            : undefined
        }
        actions={
          tracks.length > 0 && (
            <>
              <Button variant="primary" onClick={() => player.playQueue(tracks, 0)}>
                <PlayIcon size={16} /> Play all
              </Button>
              <Button onClick={shufflePlay}>
                <ShuffleIcon size={16} /> Shuffle
              </Button>
            </>
          )
        }
      />

      {!library.loaded ? (
        <SkeletonRows count={6} />
      ) : all.length === 0 ? (
        <EmptyState title="Your library is empty">
          Search for a song and add it to a playlist. Every song you save appears here, so you can find it again in a
          second.
        </EmptyState>
      ) : (
        <>
          <label htmlFor="library-filter" className="sr-only">
            Search your library
          </label>
          <input
            id="library-filter"
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search your saved songs, artists and playlists"
            className={`${inputClass} mb-4`}
          />
          {shown.length === 0 ? (
            <EmptyState title={`Nothing in your library matches “${filter}”`} />
          ) : (
            <ul className="space-y-1">
              {shown.map(({ track, playlists }) => (
                <li key={track.videoId}>
                  <TrackRow
                    track={track}
                    context={tracks}
                    subtitle={`${track.channelTitle} · ${playlists.join(", ")}`}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
