"use client";

import { useRef, type ReactNode } from "react";
import { useLibrary } from "@/components/providers/LibraryProvider";
import { usePlayer } from "@/components/providers/PlayerProvider";
import { formatDuration } from "@/lib/format";
import type { Track } from "@/lib/types";
import { useAddToPlaylist } from "./AddToPlaylist";
import { IconButton } from "./primitives";
import { CheckIcon, MoreIcon, PauseIcon, PlayIcon, PlusIcon } from "./icons";
import { Equalizer } from "./Equalizer";
import { Thumb } from "./Thumb";

export function TrackRow({
  track,
  context,
  leading,
  trailing,
  showAdd = true,
  subtitle,
}: {
  track: Track;
  /** The list this song belongs to, so playback continues through it. */
  context?: Track[];
  leading?: ReactNode;
  trailing?: ReactNode;
  showAdd?: boolean;
  subtitle?: string;
}) {
  const player = usePlayer();
  const addToPlaylist = useAddToPlaylist();
  const library = useLibrary();
  // Show a tick when this song is already saved in at least one playlist.
  const savedIn = library.playlists.filter((p) => p.tracks.some((t) => t.videoId === track.videoId));
  const isSaved = savedIn.length > 0;
  const menuRef = useRef<HTMLDetailsElement>(null);
  const isCurrent = player.current?.videoId === track.videoId;
  const isPlaying = isCurrent && player.playing;
  const closeMenu = () => menuRef.current?.removeAttribute("open");

  return (
    <div
      className={`group flex items-center gap-2 rounded-xl p-2 transition-colors hover:bg-white/[.04] ${
        isCurrent ? "bg-violet/10" : ""
      }`}
    >
      {leading}
      <button
        type="button"
        onClick={() => (isCurrent ? player.toggle() : player.playTrack(track, context))}
        aria-label={`${isPlaying ? "Pause" : "Play"} ${track.title}`}
        className="relative shrink-0 rounded-lg"
      >
        <Thumb track={track} className="w-24 sm:w-28" />
        <span
          className={`absolute inset-0 grid place-items-center rounded-lg bg-black/45 text-white transition-opacity ${
            isCurrent ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
          }`}
        >
          {isPlaying ? <PauseIcon size={26} /> : <PlayIcon size={26} />}
        </span>
        {isCurrent && (
          <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-1 text-violet group-hover:hidden">
            <Equalizer playing={isPlaying} />
          </span>
        )}
        {track.durationSeconds ? (
          <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-medium tabular-nums">
            {formatDuration(track.durationSeconds)}
          </span>
        ) : null}
      </button>

      <div className="min-w-0 flex-1 px-1">
        <p className={`line-clamp-2 text-sm font-medium leading-snug ${isCurrent ? "text-violet" : ""}`}>
          {track.title}
        </p>
        <p className="mt-0.5 truncate text-xs text-muted">{subtitle ?? track.channelTitle}</p>
      </div>

      <div className="flex shrink-0 items-center">
        {showAdd && (
          <IconButton
            label={isSaved ? `${track.title} is saved. Add to another playlist` : `Add ${track.title} to a playlist`}
            onClick={() => addToPlaylist.open(track)}
            className={isSaved ? "text-ok" : ""}
          >
            {isSaved ? <CheckIcon /> : <PlusIcon />}
          </IconButton>
        )}
        <details
          ref={menuRef}
          className="relative"
          onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && closeMenu()}
        >
          <summary
            aria-label={`More options for ${track.title}`}
            className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-full text-fg hover:bg-white/10 [&::-webkit-details-marker]:hidden"
          >
            <MoreIcon />
          </summary>
          <div className="absolute right-0 top-11 z-20 w-44 rounded-xl border border-line bg-raised p-1 text-sm shadow-xl shadow-black/50">
            <MenuItem
              onClick={() => {
                player.playNextTrack(track);
                closeMenu();
              }}
            >
              Play next
            </MenuItem>
            <MenuItem
              onClick={() => {
                player.enqueue(track);
                closeMenu();
              }}
            >
              Add to queue
            </MenuItem>
            <MenuItem
              onClick={() => {
                addToPlaylist.open(track);
                closeMenu();
              }}
            >
              Add to playlist…
            </MenuItem>
          </div>
        </details>
        {trailing}
      </div>
    </div>
  );
}

function MenuItem({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-white/10">
      {children}
    </button>
  );
}
