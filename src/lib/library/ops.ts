import { MAX_RECENT, type LibraryState, type Playlist, type Settings, type Track } from "@/lib/types";

/**
 * Every change the user makes is described as an "operation". The same
 * operation is (1) applied immediately on screen and (2) sent to the cloud
 * database. Operations are written so that sending them twice is harmless,
 * which makes retrying after a network failure safe.
 */
export type Op =
  | { type: "createPlaylist"; id: string; name: string; at: string }
  | { type: "renamePlaylist"; id: string; name: string; at: string }
  | { type: "softDeletePlaylist"; id: string; at: string }
  | { type: "restorePlaylist"; id: string; at: string }
  | { type: "permanentDeletePlaylist"; id: string }
  | { type: "addTrack"; playlistId: string; track: Track; at: string }
  | { type: "removeTrack"; playlistId: string; videoId: string; at: string }
  | { type: "reorderTracks"; playlistId: string; videoIds: string[]; at: string }
  | { type: "duplicatePlaylist"; sourceId: string; newId: string; name: string; at: string }
  | { type: "recordPlay"; track: Track; at: string }
  | { type: "updateSettings"; patch: Partial<Settings> };

export interface QueuedOp {
  opId: string;
  op: Op;
  createdAt: string;
  attempts: number;
}

export interface FailedOp extends QueuedOp {
  error: string;
}

const touch = (p: Playlist, at: string): Playlist => ({ ...p, updatedAt: at });

function mapPlaylist(state: LibraryState, id: string, fn: (p: Playlist) => Playlist): LibraryState {
  let changed = false;
  const playlists = state.playlists.map((p) => {
    if (p.id !== id) return p;
    changed = true;
    return fn(p);
  });
  return changed ? { ...state, playlists } : state;
}

/**
 * Pure function: returns the new library after one operation.
 * Mirrors what the database functions do, so the screen matches the cloud.
 */
export function applyOp(state: LibraryState, op: Op): LibraryState {
  switch (op.type) {
    case "createPlaylist": {
      if (state.playlists.some((p) => p.id === op.id)) return state;
      const playlist: Playlist = {
        id: op.id,
        name: op.name.trim(),
        description: null,
        createdAt: op.at,
        updatedAt: op.at,
        deletedAt: null,
        tracks: [],
      };
      return { ...state, playlists: [playlist, ...state.playlists] };
    }

    case "renamePlaylist":
      return mapPlaylist(state, op.id, (p) => ({ ...touch(p, op.at), name: op.name.trim() }));

    case "softDeletePlaylist":
      return mapPlaylist(state, op.id, (p) => (p.deletedAt ? p : { ...p, deletedAt: op.at }));

    case "restorePlaylist":
      return mapPlaylist(state, op.id, (p) => ({ ...touch(p, op.at), deletedAt: null }));

    case "permanentDeletePlaylist": {
      const target = state.playlists.find((p) => p.id === op.id);
      // Mirrors the database rule: only trashed playlists can be erased.
      if (!target || !target.deletedAt) return state;
      return { ...state, playlists: state.playlists.filter((p) => p.id !== op.id) };
    }

    case "addTrack":
      return mapPlaylist(state, op.playlistId, (p) => {
        if (p.deletedAt) return p;
        if (p.tracks.some((t) => t.videoId === op.track.videoId)) return p;
        return { ...touch(p, op.at), tracks: [...p.tracks, op.track] };
      });

    case "removeTrack":
      return mapPlaylist(state, op.playlistId, (p) => {
        if (p.deletedAt) return p;
        return { ...touch(p, op.at), tracks: p.tracks.filter((t) => t.videoId !== op.videoId) };
      });

    case "reorderTracks":
      return mapPlaylist(state, op.playlistId, (p) => {
        if (p.deletedAt) return p;
        return { ...touch(p, op.at), tracks: reorder(p.tracks, op.videoIds) };
      });

    case "duplicatePlaylist": {
      const source = state.playlists.find((p) => p.id === op.sourceId && !p.deletedAt);
      if (!source || state.playlists.some((p) => p.id === op.newId)) return state;
      const copy: Playlist = {
        ...source,
        id: op.newId,
        name: op.name.trim(),
        createdAt: op.at,
        updatedAt: op.at,
        deletedAt: null,
        tracks: source.tracks.map((t) => ({ ...t })),
      };
      return { ...state, playlists: [copy, ...state.playlists] };
    }

    case "recordPlay": {
      const entry = { ...op.track, playedAt: op.at };
      const recent = [entry, ...state.recent.filter((r) => r.videoId !== op.track.videoId)];
      return { ...state, recent: recent.slice(0, MAX_RECENT) };
    }

    case "updateSettings":
      return { ...state, settings: { ...state.settings, ...op.patch } };
  }
}

/**
 * Put the listed songs first, in the given order. Songs that are in the
 * playlist but not in the list stay, after the listed ones. Nothing is dropped.
 * (The database function behaves identically.)
 */
export function reorder(tracks: Track[], videoIds: string[]): Track[] {
  const byId = new Map(tracks.map((t) => [t.videoId, t]));
  const seen = new Set<string>();
  const first: Track[] = [];
  for (const id of videoIds) {
    const t = byId.get(id);
    if (t && !seen.has(id)) {
      seen.add(id);
      first.push(t);
    }
  }
  const rest = tracks.filter((t) => !seen.has(t.videoId));
  return [...first, ...rest];
}

/** Apply a list of operations on top of a base library. */
export function applyOps(base: LibraryState, ops: readonly Op[]): LibraryState {
  return ops.reduce(applyOp, base);
}
