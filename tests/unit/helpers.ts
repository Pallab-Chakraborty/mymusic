import { applyOp, type Op } from "@/lib/library/ops";
import { RemoteError } from "@/lib/library/errors";
import type { LibraryRemote } from "@/lib/library/remote";
import { EMPTY_LIBRARY, type LibraryState, type Track } from "@/lib/types";

export const mkTrack = (n: number): Track => ({
  videoId: `vid${String(n).padStart(8, "0")}`,
  title: `Song ${n}`,
  channelTitle: `Channel ${n}`,
  thumbnailUrl: `https://i.ytimg.com/vi/vid${String(n).padStart(8, "0")}/hqdefault.jpg`,
  durationSeconds: 200 + n,
});

const T0 = "2026-10-15T10:00:00.000Z";
export const at = (sec = 0) => new Date(Date.parse(T0) + sec * 1000).toISOString();

/** In-memory stand-in for the cloud, with switches to simulate failures. */
export class FakeRemote implements LibraryRemote {
  server: LibraryState = EMPTY_LIBRARY;
  applied: Op[] = [];
  fetchCount = 0;
  purgeCount = 0;
  /** Errors thrown by the next N apply() calls (consumed in order). */
  nextApplyErrors: unknown[] = [];
  /** When set, every call fails like a dropped connection. */
  down = false;
  /** Make fetchAll wait until released (to test the "show cached copy first" path). */
  fetchGate: Promise<void> | null = null;

  async fetchAll() {
    this.fetchCount++;
    if (this.fetchGate) await this.fetchGate;
    if (this.down) throw new TypeError("Failed to fetch");
    return structuredClone(this.server);
  }

  async apply(op: Op) {
    if (this.down) throw new TypeError("Failed to fetch");
    const next = this.nextApplyErrors.shift();
    if (next) throw next;
    this.applied.push(op);
    this.server = applyOp(this.server, op);
  }

  async purgeExpired() {
    this.purgeCount++;
    return 0;
  }
}

export const permanent = (message = "refused") => new RemoteError(message, "permanent", "P0002");
export const authError = () => new RemoteError("Your session has expired. Please sign in again.", "auth", "PGRST301");

export async function settle(times = 20) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}
