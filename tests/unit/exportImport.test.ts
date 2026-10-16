import { describe, expect, it } from "vitest";
import { buildExport, buildM3u, parseExport, safeFileName, EXPORT_FORMAT } from "@/lib/exportImport";
import type { Playlist } from "@/lib/types";
import { at, mkTrack } from "./helpers";

const playlist = (name: string, ns: number[]): Playlist => ({
  id: name,
  name,
  description: "desc",
  createdAt: at(),
  updatedAt: at(),
  deletedAt: null,
  tracks: ns.map(mkTrack),
});

describe("JSON export and import", () => {
  it("round-trips playlists, order and metadata", () => {
    const src = [playlist("Road trip", [3, 1, 2]), playlist("Focus", [5])];
    const json = buildExport(src, new Date("2026-10-15T00:00:00Z"));
    const result = parseExport(JSON.parse(json));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.playlists.map((p) => p.name)).toEqual(["Road trip", "Focus"]);
    expect(result.playlists[0].tracks.map((t) => t.videoId)).toEqual(src[0].tracks.map((t) => t.videoId));
    expect(result.playlists[0].tracks[0]).toMatchObject({
      title: "Song 3",
      channelTitle: "Channel 3",
      durationSeconds: 203,
    });
    expect(result.playlists[0].description).toBe("desc");
  });

  it("export file declares its format and version", () => {
    const parsed = JSON.parse(buildExport([playlist("A", [1])]));
    expect(parsed.format).toBe(EXPORT_FORMAT);
    expect(parsed.version).toBe(1);
  });

  it("drops repeated songs within a playlist", () => {
    const file = JSON.parse(buildExport([playlist("A", [1, 2])]));
    file.playlists[0].tracks.push(file.playlists[0].tracks[0]);
    const result = parseExport(file);
    expect(result.ok && result.playlists[0].tracks).toHaveLength(2);
  });

  it("never trusts thumbnail addresses from a file (prevents tracking pixels)", () => {
    const file = JSON.parse(buildExport([playlist("A", [1])]));
    file.playlists[0].tracks[0].thumbnailUrl = "https://evil.example/track.gif";
    const result = parseExport(file);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.playlists[0].tracks[0].thumbnailUrl).toMatch(/^https:\/\/i\.ytimg\.com\/vi\//);
  });

  it.each([
    ["not an object", "hello"],
    ["wrong format", { format: "other", version: 1, playlists: [] }],
    ["wrong version", { format: EXPORT_FORMAT, version: 99, playlists: [{ name: "x", tracks: [] }] }],
    ["no playlists", { format: EXPORT_FORMAT, version: 1, playlists: [] }],
  ])("rejects %s", (_label, input) => {
    expect(parseExport(input).ok).toBe(false);
  });

  it("rejects bad track data with a helpful message", () => {
    const bad = {
      format: EXPORT_FORMAT,
      version: 1,
      playlists: [{ name: "A", tracks: [{ videoId: "short", title: "t" }] }],
    };
    const result = parseExport(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/problem/i);
  });

  it("rejects empty and over-long names", () => {
    const mk = (name: string) => ({ format: EXPORT_FORMAT, version: 1, playlists: [{ name, tracks: [] }] });
    expect(parseExport(mk("   ")).ok).toBe(false);
    expect(parseExport(mk("x".repeat(101))).ok).toBe(false);
  });
});

describe("M3U export", () => {
  it("writes the standard header, lengths, and YouTube links", () => {
    const m3u = buildM3u(playlist("Road trip", [1, 2]));
    const lines = m3u.trim().split("\n");
    expect(lines[0]).toBe("#EXTM3U");
    expect(lines[1]).toBe("#PLAYLIST:Road trip");
    expect(m3u).toContain("#EXTINF:201,Channel 1 - Song 1");
    expect(m3u).toContain("https://www.youtube.com/watch?v=vid00000001");
  });

  it("keeps the exact video id in a documented comment line", () => {
    expect(buildM3u(playlist("A", [7]))).toContain("#MYMUSIC:videoId=vid00000007");
  });

  it("cannot be tricked into extra lines by newlines in titles", () => {
    const p = playlist("A", [1]);
    p.tracks[0] = { ...p.tracks[0], title: "Evil\n#EXTINF:1,Injected\nhttps://evil.example" };
    const lines = buildM3u(p).trim().split("\n");
    expect(lines.filter((l) => l.startsWith("http"))).toEqual(["https://www.youtube.com/watch?v=vid00000001"]);
  });

  it("uses -1 for unknown duration", () => {
    const p = playlist("A", [1]);
    p.tracks[0] = { ...p.tracks[0], durationSeconds: null };
    expect(buildM3u(p)).toContain("#EXTINF:-1,");
  });
});

describe("safeFileName", () => {
  it("removes unsafe characters", () => {
    expect(safeFileName("../../etc/passwd", "json")).toBe("etcpasswd.json");
    expect(safeFileName("Road trip: 2026!", "m3u")).toBe("Road-trip-2026.m3u");
    expect(safeFileName("???", "json")).toBe("playlist.json");
  });
});
