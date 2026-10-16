"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useLibrary } from "@/components/providers/LibraryProvider";
import { PlaylistCard } from "@/components/ui/PlaylistCard";
import { TrashList } from "@/components/ui/TrashList";
import { Button, EmptyState, PageHeader, SkeletonRows, inputClass } from "@/components/ui/primitives";
import { PlusIcon } from "@/components/ui/icons";
import { MAX_PLAYLIST_NAME } from "@/lib/types";

export function PlaylistsView() {
  const library = useLibrary();
  const [name, setName] = useState("");

  function create(e: FormEvent) {
    e.preventDefault();
    if (library.createPlaylist(name)) setName("");
  }

  return (
    <>
      <PageHeader title="Playlists" subtitle="Saved to your account and kept until you delete them." />

      <form onSubmit={create} className="mb-8 flex gap-2">
        <label htmlFor="create-playlist" className="sr-only">
          New playlist name
        </label>
        <input
          id="create-playlist"
          value={name}
          maxLength={MAX_PLAYLIST_NAME}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name a new playlist"
          className={inputClass}
        />
        <Button type="submit" variant="primary" disabled={!name.trim()}>
          <PlusIcon size={16} /> Create
        </Button>
      </form>

      {!library.loaded ? (
        <SkeletonRows count={3} />
      ) : library.playlists.length === 0 ? (
        <EmptyState title="No playlists yet">
          Create one above, or{" "}
          <Link href="/search" className="text-violet underline">
            search for a song
          </Link>{" "}
          and add it to a new playlist.
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {library.playlists.map((p) => (
            <li key={p.id}>
              <PlaylistCard playlist={p} />
            </li>
          ))}
        </ul>
      )}

      {library.trash.length > 0 && (
        <section className="mt-12" aria-labelledby="trash-heading">
          <h2 id="trash-heading" className="mb-1 text-lg font-semibold">
            Recently deleted
          </h2>
          <p className="mb-4 text-sm text-muted">
            Deleted playlists wait here for {library.library.settings.trashRetentionDays} days, then are removed for
            good. You can change this in Settings.
          </p>
          <TrashList />
        </section>
      )}
    </>
  );
}
