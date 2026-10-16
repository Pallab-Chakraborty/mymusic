import { describe, expect, it } from "vitest";
import { filterTracks, sortTracks } from "@/lib/sortTracks";
import type { Track } from "@/lib/types";

const t = (videoId: string, title: string, channelTitle: string, durationSeconds: number | null): Track => ({
  videoId,
  title,
  channelTitle,
  thumbnailUrl: null,
  durationSeconds,
});
const list = [
  t("a", "banana", "Zed", 200),
  t("b", "Apple", "yan", null),
  t("c", "cherry 10", "Zed", 100),
  t("d", "cherry 9", "Xi", 300),
];
const ids = (xs: Track[]) => xs.map((x) => x.videoId).join("");

describe("sortTracks", () => {
  it("manual keeps the order and returns a copy", () => {
    const out = sortTracks(list, "manual");
    expect(ids(out)).toBe("abcd");
    expect(out).not.toBe(list);
  });
  it("sorts titles ignoring case, with numbers in natural order", () => {
    expect(ids(sortTracks(list, "title-asc"))).toBe("badc");
    expect(ids(sortTracks(list, "title-desc"))).toBe("cdab");
  });
  it("sorts by artist, then title", () => {
    expect(ids(sortTracks(list, "artist-asc"))).toBe("dbac");
    expect(ids(sortTracks(list, "artist-desc"))).toBe("acbd");
  });
  it("sorts by length with unknown lengths last in both directions", () => {
    expect(ids(sortTracks(list, "length-desc"))).toBe("dacb");
    expect(ids(sortTracks(list, "length-asc"))).toBe("cadb");
  });
  it("is stable for ties", () => {
    const same = [t("x", "Same", "A", 5), t("y", "same", "B", 5)];
    expect(ids(sortTracks(same, "title-asc"))).toBe("xy");
  });
  it("never changes the input", () => {
    const copy = [...list];
    sortTracks(list, "title-desc");
    expect(list).toEqual(copy);
  });
});

describe("filterTracks", () => {
  it("matches title or artist, any case, all words", () => {
    expect(ids(filterTracks(list, "CHERRY"))).toBe("cd");
    expect(ids(filterTracks(list, "zed ban"))).toBe("a");
    expect(ids(filterTracks(list, "yan"))).toBe("b");
  });
  it("returns everything for an empty search", () => {
    expect(ids(filterTracks(list, "   "))).toBe("abcd");
  });
  it("returns nothing when nothing matches", () => {
    expect(filterTracks(list, "zzz")).toEqual([]);
  });
});
