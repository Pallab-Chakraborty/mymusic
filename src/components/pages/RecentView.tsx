"use client";

import { useLibrary } from "@/components/providers/LibraryProvider";
import { usePlayer } from "@/components/providers/PlayerProvider";
import { TrackRow } from "@/components/ui/TrackRow";
import { Button, EmptyState, PageHeader, SkeletonRows } from "@/components/ui/primitives";
import { PlayIcon } from "@/components/ui/icons";
import { timeAgo } from "@/lib/format";

export function RecentView() {
  const library = useLibrary();
  const player = usePlayer();
  const recent = library.library.recent;

  return (
    <>
      <PageHeader
        title="Recently Played"
        subtitle="Your listening history inside MyMusic. It is separate from your YouTube watch history."
        actions={
          recent.length > 0 && (
            <Button variant="primary" onClick={() => player.playQueue(recent, 0)}>
              <PlayIcon size={16} /> Play all
            </Button>
          )
        }
      />
      {!library.loaded ? (
        <SkeletonRows count={6} />
      ) : recent.length === 0 ? (
        <EmptyState title="Nothing played yet">Play a song and it will appear here, newest first.</EmptyState>
      ) : (
        <ul className="space-y-1">
          {recent.map((t) => (
            <li key={t.videoId}>
              <TrackRow track={t} context={recent} subtitle={`${t.channelTitle} · ${timeAgo(t.playedAt)}`} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
