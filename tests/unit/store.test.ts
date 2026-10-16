import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryStore } from "@/lib/library/store";
import { MemoryStorage } from "@/lib/library/storage";
import type { Op } from "@/lib/library/ops";
import { EMPTY_LIBRARY } from "@/lib/types";
import { FakeRemote, at, authError, mkTrack, permanent, settle } from "./helpers";

const USER = "user-1";
let remote: FakeRemote;
let storage: MemoryStorage;
let online: boolean;
let counter: number;
const stores: LibraryStore[] = [];

function makeStore(overrides: { storage?: MemoryStorage; remote?: FakeRemote } = {}) {
  const s = new LibraryStore({
    userId: USER,
    remote: overrides.remote ?? remote,
    storage: overrides.storage ?? storage,
    isOnline: () => online,
    newId: () => `id-${++counter}`,
    now: () => at(counter),
    backoffMs: [1000, 2000, 4000],
  });
  stores.push(s);
  return s;
}

const create = (id = "p1", name = "Mix"): Op => ({ type: "createPlaylist", id, name, at: at(1) });
const add = (n: number, playlistId = "p1"): Op => ({ type: "addTrack", playlistId, track: mkTrack(n), at: at(2) });

beforeEach(() => {
  vi.useFakeTimers();
  remote = new FakeRemote();
  storage = new MemoryStorage();
  online = true;
  counter = 0;
});

afterEach(() => {
  stores.splice(0).forEach((s) => s.dispose());
  vi.useRealTimers();
});

describe("restarting (React development mode starts, stops and restarts on purpose)", () => {
  it("still sends changes to the cloud after dispose() and start()", async () => {
    const store = makeStore();
    const first = store.start();
    store.dispose();
    const second = store.start();
    await Promise.all([first, second]);
    await settle();

    store.dispatch(create());
    store.dispatch(add(1));
    await settle();

    expect(store.getSnapshot().status).toBe("saved");
    expect(store.getSnapshot().pendingCount).toBe(0);
    expect(remote.applied.map((o) => o.type)).toEqual(["createPlaylist", "addTrack"]);
  });
});

describe("automatic saving", () => {
  it("shows a change at once, and reports saved only after the cloud confirmed", async () => {
    const store = makeStore();
    const saved: Op[] = [];
    store.setHandlers({ onSaved: (op) => saved.push(op) });
    await store.start();
    expect(store.getSnapshot().status).toBe("saved");

    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const realApply = remote.apply.bind(remote);
    remote.apply = async (op) => {
      await gate;
      return realApply(op);
    };

    store.dispatch(create());
    // visible immediately, but NOT reported as saved yet
    expect(store.getSnapshot().library.playlists.map((p) => p.name)).toEqual(["Mix"]);
    expect(store.getSnapshot().status).toBe("saving");
    expect(store.getSnapshot().pendingCount).toBe(1);
    expect(saved).toHaveLength(0);

    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(saved).toHaveLength(1);
    expect(store.getSnapshot().status).toBe("saved");
    expect(store.getSnapshot().pendingCount).toBe(0);
    expect(remote.server.playlists).toHaveLength(1);
  });

  it("sends changes in the order they were made", async () => {
    const store = makeStore();
    await store.start();
    store.dispatch(create());
    store.dispatch(add(1));
    store.dispatch(add(2));
    store.dispatch({
      type: "reorderTracks",
      playlistId: "p1",
      videoIds: [mkTrack(2).videoId, mkTrack(1).videoId],
      at: at(3),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(remote.applied.map((o) => o.type)).toEqual(["createPlaylist", "addTrack", "addTrack", "reorderTracks"]);
    expect(remote.server.playlists[0].tracks.map((t) => t.videoId)).toEqual([mkTrack(2).videoId, mkTrack(1).videoId]);
  });

  it("does not report success for a change that was refused", async () => {
    const store = makeStore();
    const saved: Op[] = [];
    const failed: string[] = [];
    store.setHandlers({ onSaved: (o) => saved.push(o), onFailed: (_o, m) => failed.push(m) });
    await store.start();

    remote.nextApplyErrors = [permanent("That playlist no longer exists.")];
    store.dispatch(add(1, "ghost"));
    await vi.advanceTimersByTimeAsync(0);

    expect(saved).toHaveLength(0);
    expect(failed).toEqual(["That playlist no longer exists."]);
    expect(store.getSnapshot().status).toBe("error");
    expect(store.getSnapshot().failed).toHaveLength(1);
    // the refused change is no longer shown as if it worked
    expect(store.getSnapshot().library.playlists).toHaveLength(0);
  });
});

describe("network failures and retry", () => {
  it("keeps the change, reports offline, and retries until it succeeds", async () => {
    const store = makeStore();
    const saved: Op[] = [];
    store.setHandlers({ onSaved: (o) => saved.push(o) });
    await store.start();

    remote.down = true;
    store.dispatch(create());
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot().status).toBe("offline");
    expect(store.getSnapshot().pendingCount).toBe(1);
    expect(saved).toHaveLength(0);
    // still visible to the user while waiting
    expect(store.getSnapshot().library.playlists).toHaveLength(1);

    // first retry after 1s fails again
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getSnapshot().pendingCount).toBe(1);

    remote.down = false;
    await vi.advanceTimersByTimeAsync(2000); // second retry (backoff 2s)
    expect(saved).toHaveLength(1);
    expect(store.getSnapshot().status).toBe("saved");
    expect(remote.server.playlists).toHaveLength(1);
  });

  it("retrying never creates duplicates, even if the first attempt reached the server", async () => {
    const store = makeStore();
    await store.start();
    // Server applies the change but the response is lost (network error after the write).
    const realApply = remote.apply.bind(remote);
    let first = true;
    remote.apply = async (op) => {
      await realApply(op);
      if (first) {
        first = false;
        throw new TypeError("Failed to fetch");
      }
    };
    store.dispatch(create());
    store.dispatch(add(1));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(0);

    expect(remote.server.playlists).toHaveLength(1);
    expect(remote.server.playlists[0].tracks).toHaveLength(1);
    expect(store.getSnapshot().library.playlists[0].tracks).toHaveLength(1);
    expect(store.getSnapshot().status).toBe("saved");
  });

  it("waits while the browser is offline and sends everything when it comes back", async () => {
    const store = makeStore();
    await store.start();

    online = false;
    store.notifyConnectivity();
    store.dispatch(create());
    store.dispatch(add(1));
    await vi.advanceTimersByTimeAsync(5000);
    expect(store.getSnapshot().status).toBe("offline");
    expect(store.getSnapshot().pendingCount).toBe(2);
    expect(remote.applied).toHaveLength(0);

    online = true;
    store.notifyConnectivity();
    await vi.advanceTimersByTimeAsync(0);
    expect(remote.applied.map((o) => o.type)).toEqual(["createPlaylist", "addTrack"]);
    expect(store.getSnapshot().status).toBe("saved");
  });

  it("an expired session pauses saving and keeps the changes", async () => {
    const store = makeStore();
    await store.start();
    remote.nextApplyErrors = [authError()];
    store.dispatch(create());
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot().status).toBe("error");
    expect(store.getSnapshot().message).toMatch(/sign in again/i);
    expect(store.getSnapshot().pendingCount).toBe(1);

    await vi.advanceTimersByTimeAsync(1000); // retry succeeds once the session is valid
    expect(store.getSnapshot().status).toBe("saved");
    expect(remote.server.playlists).toHaveLength(1);
  });
});

describe("local cache and reload safety", () => {
  it("changes made offline survive closing the tab and are sent after reopening", async () => {
    online = false;
    const first = makeStore();
    await first.start();
    first.dispatch(create());
    first.dispatch(add(1));
    await vi.advanceTimersByTimeAsync(0);
    first.dispose(); // tab closed

    expect(remote.server.playlists).toHaveLength(0);

    online = true;
    const second = makeStore(); // tab reopened later, same device storage
    await second.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(remote.server.playlists).toHaveLength(1);
    expect(remote.server.playlists[0].tracks).toHaveLength(1);
    expect(second.getSnapshot().pendingCount).toBe(0);
    expect(second.getSnapshot().status).toBe("saved");
  });

  it("shows the saved copy immediately, before the cloud answers", async () => {
    const seed = makeStore();
    remote.server = {
      ...EMPTY_LIBRARY,
      playlists: [
        {
          id: "p9",
          name: "Cached",
          description: null,
          createdAt: at(),
          updatedAt: at(),
          deletedAt: null,
          tracks: [mkTrack(1)],
        },
      ],
    };
    await seed.start();
    seed.dispose();

    let release!: () => void;
    remote.fetchGate = new Promise<void>((r) => (release = r));
    const store = makeStore();
    const started = store.start();
    await settle(50);

    expect(store.getSnapshot().loaded).toBe(true);
    expect(store.getSnapshot().fromCache).toBe(true);
    expect(store.getSnapshot().library.playlists.map((p) => p.name)).toEqual(["Cached"]);

    release();
    await started;
    expect(store.getSnapshot().fromCache).toBe(false);
  });

  it("opens with the saved copy when completely offline", async () => {
    const seed = makeStore();
    remote.server = {
      ...EMPTY_LIBRARY,
      playlists: [
        {
          id: "p9",
          name: "Offline view",
          description: null,
          createdAt: at(),
          updatedAt: at(),
          deletedAt: null,
          tracks: [],
        },
      ],
    };
    await seed.start();
    seed.dispose();

    online = false;
    const store = makeStore();
    await store.start();
    expect(store.getSnapshot().library.playlists.map((p) => p.name)).toEqual(["Offline view"]);
    expect(store.getSnapshot().status).toBe("offline");
  });

  it("two tabs keep their own pending changes without overwriting each other", async () => {
    online = false;
    const tabA = makeStore();
    const tabB = makeStore();
    await tabA.start();
    await tabB.start();
    tabA.dispatch(create("pa", "From A"));
    tabB.dispatch(create("pb", "From B"));
    await vi.advanceTimersByTimeAsync(0);
    tabA.dispose();
    tabB.dispose();

    online = true;
    const reopened = makeStore();
    await reopened.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(remote.server.playlists.map((p) => p.name).sort()).toEqual(["From A", "From B"]);
  });
});

describe("syncing with the cloud copy", () => {
  it("a refresh never wipes out changes that are still waiting to be sent", async () => {
    const store = makeStore();
    await store.start();
    remote.down = true;
    store.dispatch(create("p1", "Pending"));
    await vi.advanceTimersByTimeAsync(0);

    remote.down = false;
    remote.server = { ...EMPTY_LIBRARY, playlists: [] };
    await store.refresh();
    expect(store.getSnapshot().library.playlists.map((p) => p.name)).toEqual(["Pending"]);
  });

  it("picks up changes made on another device", async () => {
    const store = makeStore();
    await store.start();
    remote.server = {
      ...EMPTY_LIBRARY,
      playlists: [
        {
          id: "x",
          name: "From phone",
          description: null,
          createdAt: at(),
          updatedAt: at(),
          deletedAt: null,
          tracks: [],
        },
      ],
    };
    await store.refresh();
    expect(store.getSnapshot().library.playlists.map((p) => p.name)).toEqual(["From phone"]);
    expect(store.getSnapshot().lastSyncedAt).not.toBeNull();
  });

  it("a failed refresh keeps showing the last good copy and says offline", async () => {
    const store = makeStore();
    remote.server = {
      ...EMPTY_LIBRARY,
      playlists: [
        { id: "x", name: "Kept", description: null, createdAt: at(), updatedAt: at(), deletedAt: null, tracks: [] },
      ],
    };
    await store.start();
    remote.down = true;
    await store.refresh();
    expect(store.getSnapshot().library.playlists.map((p) => p.name)).toEqual(["Kept"]);
    expect(store.getSnapshot().status).toBe("offline");
  });

  it("cleans up expired trash once after the first successful sync", async () => {
    const store = makeStore();
    await store.start();
    expect(remote.purgeCount).toBe(1);
    await store.refresh();
    expect(remote.purgeCount).toBe(1);
  });
});

describe("refused changes", () => {
  it("a refused change does not block later changes, and can be retried or discarded", async () => {
    const store = makeStore();
    await store.start();

    remote.nextApplyErrors = [permanent()];
    store.dispatch(create("p1", "Refused"));
    store.dispatch(create("p2", "Fine"));
    await vi.advanceTimersByTimeAsync(0);

    expect(remote.server.playlists.map((p) => p.name)).toEqual(["Fine"]);
    expect(store.getSnapshot().failed).toHaveLength(1);

    await store.retryFailed();
    await vi.advanceTimersByTimeAsync(0);
    expect(remote.server.playlists.map((p) => p.name).sort()).toEqual(["Fine", "Refused"]);
    expect(store.getSnapshot().failed).toHaveLength(0);
    expect(store.getSnapshot().status).toBe("saved");
  });

  it("discarding removes the failure and it stays gone after reload", async () => {
    const store = makeStore();
    await store.start();
    remote.nextApplyErrors = [permanent()];
    store.dispatch(create());
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot().failed).toHaveLength(1);

    store.discardFailed();
    await vi.advanceTimersByTimeAsync(0);
    store.dispose();

    const again = makeStore();
    await again.start();
    expect(again.getSnapshot().failed).toHaveLength(0);
  });

  it("refused changes are remembered across reloads until the user decides", async () => {
    const store = makeStore();
    await store.start();
    remote.nextApplyErrors = [permanent("nope")];
    store.dispatch(create());
    await vi.advanceTimersByTimeAsync(0);
    store.dispose();

    const again = makeStore();
    await again.start();
    expect(again.getSnapshot().failed.map((f) => f.error)).toEqual(["nope"]);
    expect(again.getSnapshot().status).toBe("error");
  });
});
