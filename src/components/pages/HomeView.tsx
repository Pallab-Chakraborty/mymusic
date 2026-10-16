"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useLibrary } from "@/components/providers/LibraryProvider";
import { usePlayer } from "@/components/providers/PlayerProvider";
import { PlaylistCard } from "@/components/ui/PlaylistCard";
import { TrackRow } from "@/components/ui/TrackRow";
import { Button, EmptyState, SkeletonRows, inputClass } from "@/components/ui/primitives";
import { PlayIcon, SearchIcon } from "@/components/ui/icons";
import { timeAgo } from "@/lib/format";
import { thumbnailFor } from "@/lib/thumbnail";

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function HomeView() {
  const router = useRouter();
  const library = useLibrary();
  const player = usePlayer();
  const [q, setQ] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    const term = q.trim();
    if (term) router.push(`/search?q=${encodeURIComponent(term)}`);
  }

  const recent = library.library.recent.slice(0, 6);
  const last = library.library.recent[0];
  const [hello] = useState(greeting);

  return (
    <div className="space-y-10">
      <section
        aria-labelledby="quick-search"
        className="relative overflow-hidden rounded-3xl border border-line bg-surface p-5 md:p-8"
      >
        {last && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnailFor(last)}
            alt=""
            aria-hidden="true"
            referrerPolicy="no-referrer"
            className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-25 blur-3xl saturate-150"
          />
        )}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-br from-violet/20 via-transparent to-blue/20"
        />
        <div className="relative">
          <p className="text-sm font-medium text-violet">{hello}</p>
          <h1 id="quick-search" className="mt-1 text-2xl font-semibold tracking-tight md:text-4xl">
            What do you want to listen to?
          </h1>
          <form onSubmit={submit} role="search" className="mt-5 flex max-w-2xl gap-2">
            <label htmlFor="home-search" className="sr-only">
              Quick search
            </label>
            <div className="relative flex-1">
              <SearchIcon
                className="pointer-events-none absolute left-3.5 top-1/2 z-10 -translate-y-1/2 text-muted"
                size={18}
              />
              <input
                id="home-search"
                type="search"
                value={q}
                maxLength={100}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search YouTube for a song or artist"
                className={`${inputClass} bg-ink/70 pl-10 backdrop-blur`}
              />
            </div>
            <Button type="submit" variant="primary" disabled={!q.trim()}>
              Search
            </Button>
          </form>
          {last && (
            <button
              type="button"
              onClick={() => player.playTrack(last, library.library.recent)}
              className="group mt-5 flex w-full max-w-md items-center gap-3 rounded-2xl border border-line bg-ink/60 p-2 pr-4 text-left backdrop-blur transition hover:border-violet/60 hover:bg-ink/80"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={thumbnailFor(last)}
                alt=""
                referrerPolicy="no-referrer"
                className="aspect-video w-24 shrink-0 rounded-xl object-cover"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-medium uppercase tracking-widest text-muted">
                  Continue listening
                </span>
                <span className="mt-0.5 block truncate text-sm font-semibold">{last.title}</span>
                <span className="block truncate text-xs text-muted">{last.channelTitle}</span>
              </span>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-violet text-ink transition group-hover:scale-110">
                <PlayIcon size={18} />
              </span>
            </button>
          )}
        </div>
      </section>

      <section aria-labelledby="home-playlists">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="home-playlists" className="text-lg font-semibold">
            Your playlists
          </h2>
          <Link href="/playlists" className="text-sm text-violet hover:underline">
            See all
          </Link>
        </div>
        {!library.loaded ? (
          <SkeletonRows count={2} />
        ) : library.playlists.length === 0 ? (
          <EmptyState
            title="No playlists yet"
            action={
              <Link
                href="/playlists"
                className="inline-flex min-h-10 items-center rounded-lg bg-violet px-4 text-sm font-semibold text-ink hover:bg-[#a193ff]"
              >
                Create your first playlist
              </Link>
            }
          >
            Playlists are saved to your account, so they are here whenever you come back, on any device.
          </EmptyState>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {library.playlists.slice(0, 8).map((p) => (
              <li key={p.id}>
                <PlaylistCard playlist={p} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="home-recent">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="home-recent" className="text-lg font-semibold">
            Recently played
          </h2>
          {recent.length > 0 && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => player.playQueue(library.library.recent, 0)}
                className="inline-flex items-center gap-1.5 text-sm text-violet hover:underline"
              >
                <PlayIcon size={14} /> Play
              </button>
              <Link href="/recent" className="text-sm text-violet hover:underline">
                See all
              </Link>
            </div>
          )}
        </div>
        {!library.loaded ? (
          <SkeletonRows count={3} />
        ) : recent.length === 0 ? (
          <EmptyState title="Nothing played yet">
            Songs you play here show up in this list. It is your own history inside MyMusic, separate from your YouTube
            watch history.
          </EmptyState>
        ) : (
          <ul className="space-y-1">
            {recent.map((t) => (
              <li key={t.videoId}>
                <TrackRow
                  track={t}
                  context={library.library.recent}
                  subtitle={`${t.channelTitle} · ${timeAgo(t.playedAt)}`}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
