"use client";

import { createContext, useCallback, useContext, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useLibrary } from "@/components/providers/LibraryProvider";
import { useToast } from "@/components/providers/ToastProvider";
import { MAX_PLAYLIST_NAME, type Track } from "@/lib/types";
import { Thumb } from "./Thumb";
import { Button, Modal, inputClass } from "./primitives";
import { CheckIcon, PlusIcon } from "./icons";

interface AddToPlaylistApi {
  open(track: Track): void;
}

const Ctx = createContext<AddToPlaylistApi | null>(null);

export function useAddToPlaylist(): AddToPlaylistApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAddToPlaylist must be used inside AddToPlaylistProvider");
  return ctx;
}

export function AddToPlaylistProvider({ children }: { children: ReactNode }) {
  const [track, setTrack] = useState<Track | null>(null);
  const open = useCallback((t: Track) => setTrack(t), []);
  const api = useMemo(() => ({ open }), [open]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <Modal open={track !== null} onClose={() => setTrack(null)} title="Add to playlist">
        {track && <Picker track={track} onDone={() => setTrack(null)} />}
      </Modal>
    </Ctx.Provider>
  );
}

function Picker({ track, onDone }: { track: Track; onDone: () => void }) {
  const library = useLibrary();
  const toast = useToast();
  const [name, setName] = useState("");

  function add(playlistId: string, playlistName: string) {
    const result = library.addTrack(playlistId, track);
    if (result === "duplicate") {
      toast.show(`Already in ${playlistName}`, { kind: "info" });
    } else if (result === "missing") {
      toast.show("That playlist no longer exists.", { kind: "error" });
    }
    // "added": the success message appears only after the cloud confirms the save.
    onDone();
  }

  function createAndAdd(e: FormEvent) {
    e.preventDefault();
    const id = library.createPlaylist(name);
    if (!id) return;
    library.addTrack(id, track);
    onDone();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-xl bg-raised p-2">
        <Thumb track={track} className="w-20" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{track.title}</p>
          <p className="truncate text-xs text-muted">{track.channelTitle}</p>
        </div>
      </div>

      {library.playlists.length > 0 ? (
        <ul className="space-y-1" aria-label="Your playlists">
          {library.playlists.map((p) => {
            const has = p.tracks.some((t) => t.videoId === track.videoId);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => add(p.id, p.name)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-white/5"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{p.name}</span>
                    <span className="text-xs text-muted">
                      {p.tracks.length} {p.tracks.length === 1 ? "song" : "songs"}
                    </span>
                  </span>
                  {has ? (
                    <span className="flex shrink-0 items-center gap-1 text-xs text-ok">
                      <CheckIcon size={16} /> Added
                    </span>
                  ) : (
                    <PlusIcon size={18} className="shrink-0 text-muted" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted">You don&apos;t have a playlist yet. Create your first one below.</p>
      )}

      <form onSubmit={createAndAdd} className="flex gap-2 border-t border-line pt-4">
        <label className="sr-only" htmlFor="new-playlist-name">
          New playlist name
        </label>
        <input
          id="new-playlist-name"
          className={inputClass}
          placeholder="New playlist name"
          maxLength={MAX_PLAYLIST_NAME}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" variant="primary" disabled={!name.trim()}>
          Create
        </Button>
      </form>
    </div>
  );
}
