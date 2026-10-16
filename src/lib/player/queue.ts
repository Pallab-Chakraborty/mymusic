import type { RepeatMode } from "@/lib/types";

/**
 * Decide which queue position plays next. Pure, so it can be tested.
 *
 * - `manual` is true when the user pressed Next, false when a song ended by itself.
 * - `history` holds recently played positions (newest last) so shuffle avoids repeats.
 * - Returns null when playback should stop.
 */
export function pickNext(args: {
  length: number;
  index: number;
  shuffle: boolean;
  repeat: RepeatMode;
  manual: boolean;
  history: number[];
  rand?: () => number;
}): number | null {
  const { length, index, shuffle, repeat, manual, history, rand = Math.random } = args;
  if (length === 0) return null;

  // A song that ends on its own repeats when "repeat one" is on.
  if (!manual && repeat === "one") return index;

  if (length === 1) return manual || repeat === "all" ? 0 : null;

  if (shuffle) {
    const recent = new Set(history.slice(-(length - 1)));
    recent.add(index);
    const fresh = Array.from({ length }, (_, i) => i).filter((i) => !recent.has(i));
    if (fresh.length > 0) return fresh[Math.floor(rand() * fresh.length)];
    // Everything has been played this round.
    if (repeat === "all" || manual) {
      const others = Array.from({ length }, (_, i) => i).filter((i) => i !== index);
      return others[Math.floor(rand() * others.length)];
    }
    return null;
  }

  if (index + 1 < length) return index + 1;
  return repeat === "all" ? 0 : null;
}

/** Position to go back to. `history` is the stack of earlier positions. */
export function pickPrevious(args: {
  length: number;
  index: number;
  repeat: RepeatMode;
  history: number[];
}): { index: number; history: number[] } | null {
  const { length, index, repeat, history } = args;
  if (length === 0) return null;
  if (history.length > 0) {
    const prev = history[history.length - 1];
    if (prev < length) return { index: prev, history: history.slice(0, -1) };
  }
  if (index > 0) return { index: index - 1, history: [] };
  if (repeat === "all" && length > 1) return { index: length - 1, history: [] };
  return null;
}

/** Remove one item from the queue and keep "what is playing" pointing at the right song. */
export function removeAt<T>(tracks: T[], index: number, removeIndex: number): { tracks: T[]; index: number } {
  if (removeIndex < 0 || removeIndex >= tracks.length) return { tracks, index };
  const next = tracks.filter((_, i) => i !== removeIndex);
  let newIndex = index;
  if (removeIndex < index) newIndex = index - 1;
  if (newIndex >= next.length) newIndex = Math.max(0, next.length - 1);
  return { tracks: next, index: newIndex };
}

/** Move a queue item up or down, keeping "what is playing" pointing at the same song. */
export function moveItem<T>(tracks: T[], index: number, from: number, to: number): { tracks: T[]; index: number } {
  if (from === to || from < 0 || to < 0 || from >= tracks.length || to >= tracks.length) return { tracks, index };
  const next = [...tracks];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  let newIndex = index;
  if (index === from) newIndex = to;
  else if (from < index && to >= index) newIndex = index - 1;
  else if (from > index && to <= index) newIndex = index + 1;
  return { tracks: next, index: newIndex };
}

/** Insert right after the current song ("play next"). */
export function insertNext<T>(tracks: T[], index: number, item: T): { tracks: T[]; at: number } {
  const at = tracks.length === 0 ? 0 : Math.min(index + 1, tracks.length);
  const next = [...tracks];
  next.splice(at, 0, item);
  return { tracks: next, at };
}
