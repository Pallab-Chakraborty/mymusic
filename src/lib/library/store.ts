import { EMPTY_LIBRARY, type LibraryState } from "@/lib/types";
import { applyOp, applyOps, type FailedOp, type Op, type QueuedOp } from "./ops";
import { toRemoteError, type RemoteError } from "./errors";
import type { LibraryRemote } from "./remote";
import type { KeyValueStorage } from "./storage";

export type SyncStatus = "loading" | "saved" | "saving" | "offline" | "error";

export interface StoreSnapshot {
  /** What the screen shows: the last cloud copy plus any changes still waiting to be sent. */
  library: LibraryState;
  status: SyncStatus;
  /** Changes made on this device that the cloud has not confirmed yet. */
  pendingCount: number;
  /** Changes the server refused. Kept so nothing disappears silently. */
  failed: FailedOp[];
  lastSyncedAt: string | null;
  /** First screen can be drawn (from the saved copy or the cloud). */
  loaded: boolean;
  /** True while showing the saved copy and the cloud has not answered yet. */
  fromCache: boolean;
  message: string | null;
}

export interface StoreOptions {
  userId: string;
  remote: LibraryRemote;
  storage: KeyValueStorage;
  isOnline?: () => boolean;
  newId?: () => string;
  now?: () => string;
  /** Wait times (ms) between retries after a network failure. */
  backoffMs?: number[];
}

export interface StoreHandlers {
  /** Called ONLY after the cloud confirmed the change. */
  onSaved?: (op: Op) => void;
  onFailed?: (op: Op, message: string) => void;
}

const DEFAULT_BACKOFF = [1000, 2000, 5000, 10000, 30000];

interface CachedServer {
  library: LibraryState;
  syncedAt: string | null;
}

export class LibraryStore {
  private readonly o: Required<Omit<StoreOptions, "backoffMs">> & { backoffMs: number[] };
  private readonly prefix: string;
  private listeners = new Set<() => void>();
  private handlers: StoreHandlers = {};

  private server: LibraryState = EMPTY_LIBRARY;
  private queue: QueuedOp[] = [];
  private failed: FailedOp[] = [];
  private lastSyncedAt: string | null = null;
  private loaded = false;
  private fromCache = true;
  private networkDown = false;
  private authProblem = false;
  private message: string | null = null;

  private starting: Promise<void> | null = null;
  private flushing = false;
  private flushAgain = false;
  private refreshing: Promise<void> | null = null;
  private refreshAfterFlush = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private persistChain: Promise<void> = Promise.resolve();
  private snap: StoreSnapshot;

  constructor(opts: StoreOptions) {
    this.o = {
      isOnline: () => (typeof navigator === "undefined" ? true : navigator.onLine),
      newId: () => crypto.randomUUID(),
      now: () => new Date().toISOString(),
      backoffMs: DEFAULT_BACKOFF,
      ...opts,
    };
    this.prefix = `mymusic:${opts.userId}:`;
    this.snap = this.buildSnapshot();
  }

  // ---- subscription (works with React's useSyncExternalStore) -------------

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snap;

  setHandlers(handlers: StoreHandlers) {
    this.handlers = handlers;
  }

  newId() {
    return this.o.newId();
  }

  now() {
    return this.o.now();
  }

  // ---- lifecycle -----------------------------------------------------------

  /**
   * Show the saved copy immediately, then sync with the cloud.
   * Safe to call again after dispose(): in development React starts, stops and restarts
   * everything on purpose, and the store must keep working after that.
   */
  start(): Promise<void> {
    this.disposed = false;
    if (this.starting) {
      // Already started (or starting): just make sure waiting changes are being sent.
      if (this.loaded && this.queue.length > 0) void this.flush();
      return this.starting;
    }
    this.starting = this.runStart();
    return this.starting;
  }

  private async runStart() {
    await this.loadFromStorage();
    this.loaded = true;
    this.commit();

    if (this.queue.length > 0) {
      this.refreshAfterFlush = true;
      await this.flush();
    } else {
      await this.refresh();
    }
    await this.purgeOnce();
  }

  dispose() {
    this.disposed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  /** Call when the browser reports it is online/offline or the tab becomes visible. */
  notifyConnectivity() {
    this.commit();
    if (this.o.isOnline()) {
      this.clearRetry();
      void this.flush().then(() => this.refresh());
    }
  }

  // ---- making changes -------------------------------------------------------

  /** Apply a change on screen at once, store it on this device, then send it to the cloud. */
  dispatch(op: Op): void {
    const queued: QueuedOp = {
      opId: this.o.newId(),
      op,
      createdAt: this.o.now(),
      attempts: 0,
    };
    this.queue = [...this.queue, queued];
    // Written to the device BEFORE any network attempt, so closing the tab
    // while offline does not lose the change.
    this.persist(() => this.storageSet(`${this.prefix}op:${queued.opId}`, queued));
    this.commit();
    void this.flush();
  }

  async retryFailed(opId?: string) {
    const toRetry = this.failed.filter((f) => !opId || f.opId === opId);
    if (toRetry.length === 0) return;
    this.failed = this.failed.filter((f) => !toRetry.includes(f));
    for (const f of toRetry) {
      const { error: _error, ...queued } = f;
      void _error;
      this.queue = [...this.queue, { ...queued, attempts: 0 }];
      this.persist(async () => {
        await this.storageSet(`${this.prefix}op:${f.opId}`, { ...queued, attempts: 0 });
        await this.storageDel(`${this.prefix}failed:${f.opId}`);
      });
    }
    this.commit();
    await this.flush();
  }

  discardFailed(opId?: string) {
    const gone = this.failed.filter((f) => !opId || f.opId === opId);
    this.failed = this.failed.filter((f) => !gone.includes(f));
    for (const f of gone) this.persist(() => this.storageDel(`${this.prefix}failed:${f.opId}`));
    this.commit();
  }

  // ---- syncing ---------------------------------------------------------------

  /** Send waiting changes one by one, in order. */
  async flush(): Promise<void> {
    if (this.disposed) return;
    if (this.flushing) {
      this.flushAgain = true;
      return;
    }
    if (this.refreshing) await this.refreshing;

    this.flushing = true;
    try {
      do {
        this.flushAgain = false;
        await this.drainQueue();
      } while (this.flushAgain && !this.networkDown && !this.authProblem);
    } finally {
      this.flushing = false;
      this.commit();
    }

    if (this.queue.length === 0 && this.refreshAfterFlush && !this.disposed) {
      this.refreshAfterFlush = false;
      await this.refresh();
    }
  }

  private async drainQueue() {
    while (this.queue.length > 0 && !this.disposed) {
      if (!this.o.isOnline()) {
        this.commit();
        return;
      }

      const head = this.queue[0];
      try {
        await this.o.remote.apply(head.op);
      } catch (raw) {
        const err = toRemoteError(raw);
        if (this.handleSendFailure(head, err)) continue;
        return;
      }

      // Confirmed by the cloud.
      this.networkDown = false;
      this.authProblem = false;
      this.message = null;
      this.server = applyOp(this.server, head.op);
      this.queue = this.queue.filter((q) => q.opId !== head.opId);
      this.persist(async () => {
        await this.storageDel(`${this.prefix}op:${head.opId}`);
        await this.saveServer();
      });
      this.commit();
      this.handlers.onSaved?.(head.op);
    }
  }

  /** Returns true if the queue should continue with the next change. */
  private handleSendFailure(head: QueuedOp, err: RemoteError): boolean {
    if (err.kind === "permanent") {
      const failedOp: FailedOp = { ...head, error: err.message };
      this.queue = this.queue.filter((q) => q.opId !== head.opId);
      this.failed = [...this.failed, failedOp];
      this.persist(async () => {
        await this.storageDel(`${this.prefix}op:${head.opId}`);
        await this.storageSet(`${this.prefix}failed:${head.opId}`, failedOp);
      });
      this.message = err.message;
      this.commit();
      this.handlers.onFailed?.(head.op, err.message);
      return true;
    }

    // Temporary problem: keep the change and try again later.
    head.attempts += 1;
    this.persist(() => this.storageSet(`${this.prefix}op:${head.opId}`, head));
    if (err.kind === "auth") this.authProblem = true;
    else this.networkDown = true;
    this.message = err.message;
    this.commit();
    this.scheduleRetry(head.attempts);
    return false;
  }

  private scheduleRetry(attempts: number) {
    this.clearRetry();
    if (this.disposed) return;
    const waits = this.o.backoffMs;
    const wait = waits[Math.min(Math.max(attempts - 1, 0), waits.length - 1)];
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.flush().then(() => this.refresh());
    }, wait);
  }

  private clearRetry() {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  /** Download the cloud copy. Pending local changes are re-applied on top. */
  refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    if (this.flushing) {
      // Do not download while sending: the result could miss the change in flight.
      this.refreshAfterFlush = true;
      return Promise.resolve();
    }
    if (!this.o.isOnline()) {
      this.commit();
      return Promise.resolve();
    }

    const run = (async () => {
      try {
        const library = await this.o.remote.fetchAll();
        if (this.disposed) return;
        this.server = library;
        this.lastSyncedAt = this.o.now();
        this.fromCache = false;
        this.networkDown = false;
        this.authProblem = false;
        if (this.failed.length === 0) this.message = null;
        this.persist(() => this.saveServer());
      } catch (raw) {
        const err = toRemoteError(raw);
        if (err.kind === "network") this.networkDown = true;
        if (err.kind === "auth") this.authProblem = true;
        this.message = err.message;
      } finally {
        this.refreshing = null;
        this.commit();
      }
    })();
    this.refreshing = run;
    return run;
  }

  private purged = false;
  private async purgeOnce() {
    if (this.purged || this.fromCache || this.disposed) return;
    this.purged = true;
    try {
      const removed = await this.o.remote.purgeExpired();
      if (removed > 0) await this.refresh();
    } catch {
      // Cleanup is best-effort; never block the app on it.
    }
  }

  // ---- persistence ---------------------------------------------------------------

  private async loadFromStorage() {
    const cached = await this.o.storage.get<CachedServer>(`${this.prefix}server`);
    if (cached) {
      this.server = cached.library;
      this.lastSyncedAt = cached.syncedAt;
    }
    const opKeys = await this.o.storage.keys(`${this.prefix}op:`);
    const ops: QueuedOp[] = [];
    for (const k of opKeys) {
      const q = await this.o.storage.get<QueuedOp>(k);
      if (q) ops.push(q);
    }
    ops.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.opId.localeCompare(b.opId));
    this.queue = ops;

    const failedKeys = await this.o.storage.keys(`${this.prefix}failed:`);
    const failed: FailedOp[] = [];
    for (const k of failedKeys) {
      const f = await this.o.storage.get<FailedOp>(k);
      if (f) failed.push(f);
    }
    failed.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    this.failed = failed;
    // Stays true until the cloud answers, even if a saved copy was found.
    this.fromCache = true;
  }

  private storageSet(key: string, value: unknown) {
    return this.o.storage.set(key, value);
  }

  private storageDel(key: string) {
    return this.o.storage.del(key);
  }

  private saveServer() {
    return this.storageSet(`${this.prefix}server`, {
      library: this.server,
      syncedAt: this.lastSyncedAt,
    } satisfies CachedServer);
  }

  /** Storage writes run one after another so they cannot overtake each other. */
  private persist(task: () => Promise<void>) {
    this.persistChain = this.persistChain.then(task).catch(() => {
      // Storage can be unavailable (private mode). The cloud copy is still authoritative.
    });
  }

  // ---- snapshot ------------------------------------------------------------------

  private commit() {
    this.snap = this.buildSnapshot();
    for (const l of this.listeners) l();
  }

  private buildSnapshot(): StoreSnapshot {
    const online = this.o.isOnline();
    let status: SyncStatus;
    if (!this.loaded) status = "loading";
    else if (!online || this.networkDown) status = "offline";
    else if (this.authProblem || this.failed.length > 0) status = "error";
    else if (this.queue.length > 0) status = "saving";
    else status = "saved";

    return {
      library: applyOps(
        this.server,
        this.queue.map((q) => q.op),
      ),
      status,
      pendingCount: this.queue.length,
      failed: this.failed,
      lastSyncedAt: this.lastSyncedAt,
      loaded: this.loaded,
      fromCache: this.fromCache,
      message: this.message,
    };
  }
}
