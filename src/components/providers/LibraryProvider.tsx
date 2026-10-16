"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createClient } from "@/lib/supabase/client";
import { LibraryStore, type StoreSnapshot } from "@/lib/library/store";
import { createSupabaseRemote } from "@/lib/library/remote";
import { IndexedDbStorage } from "@/lib/library/storage";
import { failedMessage, savedMessage } from "@/lib/library/messages";
import type { Playlist, Settings, Track } from "@/lib/types";
import { MAX_PLAYLIST_NAME } from "@/lib/types";
import { useToast } from "./ToastProvider";

export type AddTrackResult = "added" | "duplicate" | "missing";

export interface LibraryApi extends StoreSnapshot {
  /** Playlists that are not in the trash. */
  playlists: Playlist[];
  trash: Playlist[];
  createPlaylist(name: string): string | null;
  renamePlaylist(id: string, name: string): void;
  deletePlaylist(id: string): void;
  restorePlaylist(id: string): void;
  permanentlyDeletePlaylist(id: string): void;
  duplicatePlaylist(id: string): string | null;
  addTrack(playlistId: string, track: Track): AddTrackResult;
  removeTrack(playlistId: string, videoId: string): void;
  reorderTracks(playlistId: string, videoIds: string[]): void;
  recordPlay(track: Track): void;
  updateSettings(patch: Partial<Settings>): void;
  refresh(): Promise<void>;
  retryFailed(opId?: string): Promise<void>;
  discardFailed(opId?: string): void;
}

const LibraryContext = createContext<LibraryApi | null>(null);

export function useLibrary(): LibraryApi {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error("useLibrary must be used inside LibraryProvider");
  return ctx;
}

const cleanName = (name: string) => name.trim().slice(0, MAX_PLAYLIST_NAME);

export function LibraryProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const toast = useToast();

  const [store] = useState(
    () =>
      new LibraryStore({
        userId,
        remote: createSupabaseRemote(createClient(), userId),
        storage: new IndexedDbStorage(),
      }),
  );

  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  // Confirmations and errors are shown only when the cloud has answered.
  useEffect(() => {
    store.setHandlers({
      onSaved: (op) => {
        const name =
          op.type === "addTrack"
            ? store.getSnapshot().library.playlists.find((p) => p.id === op.playlistId)?.name
            : undefined;
        const message = savedMessage(op, name);
        if (!message) return;
        if (op.type === "softDeletePlaylist") {
          toast.show(message, {
            action: {
              label: "Undo",
              onClick: () => store.dispatch({ type: "restorePlaylist", id: op.id, at: store.now() }),
            },
          });
        } else {
          toast.show(message);
        }
      },
      onFailed: (op, reason) => toast.show(failedMessage(op, reason), { kind: "error" }),
    });
  }, [store, toast]);

  useEffect(() => {
    void store.start();

    const onConnectivity = () => store.notifyConnectivity();
    const onVisible = () => {
      if (document.visibilityState === "visible") void store.refresh();
    };
    window.addEventListener("online", onConnectivity);
    window.addEventListener("offline", onConnectivity);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void store.refresh();
    }, 60_000);

    return () => {
      window.removeEventListener("online", onConnectivity);
      window.removeEventListener("offline", onConnectivity);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      clearInterval(timer);
      store.dispose();
    };
  }, [store]);

  const exists = useCallback(
    (id: string) => store.getSnapshot().library.playlists.some((p) => p.id === id && !p.deletedAt),
    [store],
  );

  const api = useMemo<LibraryApi>(() => {
    const at = () => store.now();
    return {
      ...snap,
      playlists: snap.library.playlists.filter((p) => !p.deletedAt),
      trash: snap.library.playlists.filter((p) => p.deletedAt),

      createPlaylist(name) {
        const n = cleanName(name);
        if (!n) return null;
        const id = store.newId();
        store.dispatch({ type: "createPlaylist", id, name: n, at: at() });
        return id;
      },
      renamePlaylist(id, name) {
        const n = cleanName(name);
        if (n && exists(id)) store.dispatch({ type: "renamePlaylist", id, name: n, at: at() });
      },
      deletePlaylist(id) {
        if (exists(id)) store.dispatch({ type: "softDeletePlaylist", id, at: at() });
      },
      restorePlaylist(id) {
        store.dispatch({ type: "restorePlaylist", id, at: at() });
      },
      permanentlyDeletePlaylist(id) {
        store.dispatch({ type: "permanentDeletePlaylist", id });
      },
      duplicatePlaylist(id) {
        const source = store.getSnapshot().library.playlists.find((p) => p.id === id && !p.deletedAt);
        if (!source) return null;
        const newId = store.newId();
        store.dispatch({
          type: "duplicatePlaylist",
          sourceId: id,
          newId,
          name: cleanName(`${source.name} (copy)`),
          at: at(),
        });
        return newId;
      },
      addTrack(playlistId, track) {
        const playlist = store.getSnapshot().library.playlists.find((p) => p.id === playlistId && !p.deletedAt);
        if (!playlist) return "missing";
        if (playlist.tracks.some((t) => t.videoId === track.videoId)) return "duplicate";
        store.dispatch({ type: "addTrack", playlistId, track, at: at() });
        return "added";
      },
      removeTrack(playlistId, videoId) {
        store.dispatch({ type: "removeTrack", playlistId, videoId, at: at() });
      },
      reorderTracks(playlistId, videoIds) {
        store.dispatch({ type: "reorderTracks", playlistId, videoIds, at: at() });
      },
      recordPlay(track) {
        store.dispatch({ type: "recordPlay", track, at: at() });
      },
      updateSettings(patch) {
        store.dispatch({ type: "updateSettings", patch });
      },
      refresh: () => store.refresh(),
      retryFailed: (opId) => store.retryFailed(opId),
      discardFailed: (opId) => store.discardFailed(opId),
    };
  }, [snap, store, exists]);

  return <LibraryContext.Provider value={api}>{children}</LibraryContext.Provider>;
}
