import { describe, expect, it } from "vitest";
import { insertNext, moveItem, pickNext, pickPrevious, removeAt } from "@/lib/player/queue";

const base = { shuffle: false, repeat: "off" as const, manual: false, history: [] as number[] };

describe("pickNext (in order)", () => {
  it("goes to the next song and stops at the end", () => {
    expect(pickNext({ ...base, length: 3, index: 0 })).toBe(1);
    expect(pickNext({ ...base, length: 3, index: 2 })).toBeNull();
  });
  it("wraps to the start with repeat all", () => {
    expect(pickNext({ ...base, length: 3, index: 2, repeat: "all" })).toBe(0);
  });
  it("replays the same song with repeat one when it ends by itself", () => {
    expect(pickNext({ ...base, length: 3, index: 1, repeat: "one" })).toBe(1);
  });
  it("pressing Next with repeat one still moves on", () => {
    expect(pickNext({ ...base, length: 3, index: 1, repeat: "one", manual: true })).toBe(2);
  });
  it("pressing Next on the last song does nothing unless repeat all", () => {
    expect(pickNext({ ...base, length: 3, index: 2, manual: true })).toBeNull();
    expect(pickNext({ ...base, length: 3, index: 2, manual: true, repeat: "all" })).toBe(0);
  });
  it("handles empty and single-song queues", () => {
    expect(pickNext({ ...base, length: 0, index: 0 })).toBeNull();
    expect(pickNext({ ...base, length: 1, index: 0 })).toBeNull();
    expect(pickNext({ ...base, length: 1, index: 0, repeat: "all" })).toBe(0);
  });
});

describe("pickNext (shuffle)", () => {
  it("never repeats a song until all have played", () => {
    let index = 0;
    let history: number[] = [];
    const seen = new Set<number>([0]);
    for (let i = 0; i < 4; i++) {
      const next = pickNext({ ...base, shuffle: true, length: 5, index, history, rand: () => 0 })!;
      expect(seen.has(next)).toBe(false);
      seen.add(next);
      history = [...history, index];
      index = next;
    }
    expect(seen.size).toBe(5);
  });
  it("stops after a full round without repeat, starts a new round with repeat all", () => {
    const history = [0, 1, 2, 3];
    expect(pickNext({ ...base, shuffle: true, length: 5, index: 4, history })).toBeNull();
    const again = pickNext({ ...base, shuffle: true, length: 5, index: 4, history, repeat: "all" });
    expect(again).not.toBeNull();
    expect(again).not.toBe(4);
  });
  it("never picks the current song when others exist", () => {
    for (let i = 0; i < 50; i++) {
      expect(pickNext({ ...base, shuffle: true, length: 4, index: 2, history: [] })).not.toBe(2);
    }
  });
});

describe("pickPrevious", () => {
  it("returns to the song played before", () => {
    expect(pickPrevious({ length: 5, index: 3, repeat: "off", history: [0, 4] })).toEqual({ index: 4, history: [0] });
  });
  it("without history, steps back one position", () => {
    expect(pickPrevious({ length: 5, index: 3, repeat: "off", history: [] })).toEqual({ index: 2, history: [] });
  });
  it("does nothing at the start, wraps with repeat all", () => {
    expect(pickPrevious({ length: 5, index: 0, repeat: "off", history: [] })).toBeNull();
    expect(pickPrevious({ length: 5, index: 0, repeat: "all", history: [] })).toEqual({ index: 4, history: [] });
  });
  it("ignores stale history pointing past the queue", () => {
    expect(pickPrevious({ length: 2, index: 1, repeat: "off", history: [9] })).toEqual({ index: 0, history: [] });
  });
});

describe("queue editing", () => {
  it("removing before the playing song keeps the same song playing", () => {
    expect(removeAt(["a", "b", "c", "d"], 2, 0)).toEqual({ tracks: ["b", "c", "d"], index: 1 });
  });
  it("removing after the playing song leaves the index alone", () => {
    expect(removeAt(["a", "b", "c"], 0, 2)).toEqual({ tracks: ["a", "b"], index: 0 });
  });
  it("removing the last song clamps the index", () => {
    expect(removeAt(["a", "b"], 1, 1)).toEqual({ tracks: ["a"], index: 0 });
  });
  it("moves items and tracks the playing song", () => {
    expect(moveItem(["a", "b", "c", "d"], 1, 1, 3)).toEqual({ tracks: ["a", "c", "d", "b"], index: 3 });
    expect(moveItem(["a", "b", "c", "d"], 2, 0, 3)).toEqual({ tracks: ["b", "c", "d", "a"], index: 1 });
    expect(moveItem(["a", "b", "c", "d"], 1, 3, 0)).toEqual({ tracks: ["d", "a", "b", "c"], index: 2 });
    expect(moveItem(["a", "b"], 0, 0, 5)).toEqual({ tracks: ["a", "b"], index: 0 });
  });
  it("inserts 'play next' right after the current song", () => {
    expect(insertNext(["a", "b", "c"], 0, "x")).toEqual({ tracks: ["a", "x", "b", "c"], at: 1 });
    expect(insertNext([], 0, "x")).toEqual({ tracks: ["x"], at: 0 });
  });
});
