"use client";

import Link from "next/link";
import { usePlayer } from "@/components/providers/PlayerProvider";
import { formatTotalDuration } from "@/lib/format";
import type { Playlist } from "@/lib/types";
import { PlaylistCover } from "./Thumb";
import { PlayIcon } from "./icons";

export function PlaylistCard({ playlist }: { playlist: Playlist }) {
  const player = usePlayer();
  const total = playlist.tracks.reduce((sum, t) => sum + (t.durationSeconds ?? 0), 0);
  const count = playlist.tracks.length;

  return (
    <div className="group relative rounded-2xl bg-surface p-3 transition duration-200 hover:-translate-y-0.5 hover:bg-raised hover:shadow-xl hover:shadow-black/40">
      <Link href={`/playlists/${playlist.id}`} className="block rounded-xl">
        <PlaylistCover tracks={playlist.tracks} className="w-full" />
        <h3 className="mt-3 truncate text-sm font-semibold">{playlist.name}</h3>
        <p className="mt-0.5 text-xs text-muted">
          {count} {count === 1 ? "song" : "songs"}
          {total > 0 ? ` · ${formatTotalDuration(total)}` : ""}
        </p>
      </Link>
      {count > 0 && (
        <button
          type="button"
          onClick={() => player.playQueue(playlist.tracks, 0)}
          aria-label={`Play ${playlist.name}`}
          className="absolute right-5 top-[calc(100%-5.25rem)] grid h-11 w-11 place-items-center rounded-full bg-violet text-ink opacity-100 shadow-lg shadow-black/50 transition md:translate-y-1 md:opacity-0 md:group-hover:translate-y-0 md:group-hover:opacity-100 md:group-focus-within:translate-y-0 md:group-focus-within:opacity-100"
        >
          <PlayIcon size={20} />
        </button>
      )}
    </div>
  );
}
