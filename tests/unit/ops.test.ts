import { describe, expect, it } from "vitest";
import { applyOp, applyOps, reorder, type Op } from "@/lib/library/ops";
import { EMPTY_LIBRARY, MAX_RECENT } from "@/lib/types";
import { at, mkTrack } from "./helpers";

const create = (id: string, name = "Mix", sec = 0): Op => ({ type: "createPlaylist", id, name, at: at(sec) });
const add = (playlistId: string, n: number, sec = 1): Op => ({
  type: "addTrack",
  playlistId,
  track: mkTrack(n),
  at: at(sec),
});
const ids = (state: ReturnType<typeof applyOps>, playlistId: string) =>
  state.playlists.find((p) => p.id === playlistId)!.tracks.map((t) => t.videoId);
const v = (n: number) => mkTrack(n).videoId;

describe("playlist creation and editing", () => {
  it("creates a playlist (trimmed) at the top of the list", () => {
    const s = applyOps(EMPTY_LIBRARY, [create("a", "  First  "), create("b", "Second")]);
    expect(s.playlists.map((p) => p.name)).toEqual(["Second", "First"]);
    expect(s.playlists[1]).toMatchObject({ deletedAt: null, tracks: [] });
  });

  it("is idempotent: creating the same id twice keeps one playlist", () => {
    const s = applyOps(EMPTY_LIBRARY, [create("a"), create("a", "Other name")]);
    expect(s.playlists).toHaveLength(1);
    expect(s.playlists[0].name).toBe("Mix");
  });

  it("renames", () => {
    const s = applyOps(EMPTY_LIBRARY, [create("a"), { type: "renamePlaylist", id: "a", name: " New ", at: at(5) }]);
    expect(s.playlists[0]).toMatchObject({ name: "New", updatedAt: at(5) });
  });

  it("ignores edits to a playlist that does not exist", () => {
    const s = applyOps(EMPTY_LIBRARY, [{ type: "renamePlaylist", id: "nope", name: "x", at: at() }, add("nope", 1)]);
    expect(s).toBe(EMPTY_LIBRARY);
  });
});

describe("track ordering", () => {
  it("adds in order and never adds the same song twice", () => {
    const s = applyOps(EMPTY_LIBRARY, [create("a"), add("a", 1), add("a", 2), add("a", 1), add("a", 3)]);
    expect(ids(s, "a")).toEqual([v(1), v(2), v(3)]);
  });

  it("allows the same song in different playlists", () => {
    const s = applyOps(EMPTY_LIBRARY, [create("a"), create("b"), add("a", 1), add("b", 1)]);
    expect(ids(s, "a")).toEqual([v(1)]);
    expect(ids(s, "b")).toEqual([v(1)]);
  });

  it("removes a track and keeps the rest in order", () => {
    const s = applyOps(EMPTY_LIBRARY, [
      create("a"),
      add("a", 1),
      add("a", 2),
      add("a", 3),
      { type: "removeTrack", playlistId: "a", videoId: v(2), at: at(9) },
    ]);
    expect(ids(s, "a")).toEqual([v(1), v(3)]);
  });

  it("reorders to the requested order", () => {
    const s = applyOps(EMPTY_LIBRARY, [
      create("a"),
      add("a", 1),
      add("a", 2),
      add("a", 3),
      { type: "reorderTracks", playlistId: "a", videoIds: [v(3), v(1), v(2)], at: at(9) },
    ]);
    expect(ids(s, "a")).toEqual([v(3), v(1), v(2)]);
  });

  it("reorder keeps songs missing from the list (never drops data)", () => {
    const tracks = [1, 2, 3, 4].map(mkTrack);
    expect(reorder(tracks, [v(3), v(1)]).map((t) => t.videoId)).toEqual([v(3), v(1), v(2), v(4)]);
  });

  it("reorder ignores unknown and repeated ids", () => {
    const tracks = [1, 2].map(mkTrack);
    expect(reorder(tracks, [v(2), v(2), v(99), v(1)]).map((t) => t.videoId)).toEqual([v(2), v(1)]);
  });
});

describe("deleted-playlist recovery", () => {
  const base = [create("a"), add("a", 1), add("a", 2)];

  it("soft delete keeps the tracks, restore brings everything back", () => {
    const trashed = applyOps(EMPTY_LIBRARY, [...base, { type: "softDeletePlaylist", id: "a", at: at(10) }]);
    expect(trashed.playlists[0].deletedAt).toBe(at(10));
    expect(ids(trashed, "a")).toEqual([v(1), v(2)]);

    const restored = applyOp(trashed, { type: "restorePlaylist", id: "a", at: at(20) });
    expect(restored.playlists[0].deletedAt).toBeNull();
    expect(ids(restored, "a")).toEqual([v(1), v(2)]);
  });

  it("cannot add, remove or reorder while a playlist is in the trash", () => {
    const trashed = applyOps(EMPTY_LIBRARY, [...base, { type: "softDeletePlaylist", id: "a", at: at(10) }]);
    const after = applyOps(trashed, [
      add("a", 3),
      { type: "removeTrack", playlistId: "a", videoId: v(1), at: at(11) },
      { type: "reorderTracks", playlistId: "a", videoIds: [v(2), v(1)], at: at(12) },
    ]);
    expect(ids(after, "a")).toEqual([v(1), v(2)]);
  });

  it("permanent delete only works on trashed playlists", () => {
    const active = applyOps(EMPTY_LIBRARY, base);
    expect(applyOp(active, { type: "permanentDeletePlaylist", id: "a" }).playlists).toHaveLength(1);

    const trashed = applyOp(active, { type: "softDeletePlaylist", id: "a", at: at(10) });
    expect(applyOp(trashed, { type: "permanentDeletePlaylist", id: "a" }).playlists).toHaveLength(0);
  });

  it("soft-deleting twice keeps the first deletion time", () => {
    const s = applyOps(EMPTY_LIBRARY, [
      create("a"),
      { type: "softDeletePlaylist", id: "a", at: at(10) },
      { type: "softDeletePlaylist", id: "a", at: at(99) },
    ]);
    expect(s.playlists[0].deletedAt).toBe(at(10));
  });
});

describe("duplicate", () => {
  it("copies tracks in order and stays independent", () => {
    const s = applyOps(EMPTY_LIBRARY, [
      create("a", "Original"),
      add("a", 2),
      add("a", 1),
      { type: "duplicatePlaylist", sourceId: "a", newId: "b", name: "Copy", at: at(9) },
      { type: "removeTrack", playlistId: "b", videoId: v(2), at: at(10) },
    ]);
    expect(ids(s, "a")).toEqual([v(2), v(1)]);
    expect(ids(s, "b")).toEqual([v(1)]);
  });

  it("does nothing for a missing or trashed source", () => {
    const s = applyOps(EMPTY_LIBRARY, [
      create("a"),
      { type: "softDeletePlaylist", id: "a", at: at(1) },
      { type: "duplicatePlaylist", sourceId: "a", newId: "b", name: "Copy", at: at(2) },
      { type: "duplicatePlaylist", sourceId: "zzz", newId: "c", name: "Copy", at: at(2) },
    ]);
    expect(s.playlists).toHaveLength(1);
  });
});

describe("recently played and settings", () => {
  it("most recent first, no duplicates, capped", () => {
    let s = EMPTY_LIBRARY;
    for (let n = 1; n <= MAX_RECENT + 5; n++) s = applyOp(s, { type: "recordPlay", track: mkTrack(n), at: at(n) });
    s = applyOp(s, { type: "recordPlay", track: mkTrack(50), at: at(999) });
    expect(s.recent).toHaveLength(MAX_RECENT);
    expect(s.recent[0].videoId).toBe(v(50));
    expect(new Set(s.recent.map((r) => r.videoId)).size).toBe(MAX_RECENT);
  });

  it("updates settings partially", () => {
    const s = applyOp(EMPTY_LIBRARY, { type: "updateSettings", patch: { trashRetentionDays: 90 } });
    expect(s.settings).toEqual({ trashRetentionDays: 90, shuffle: false, repeatMode: "off" });
  });
});
