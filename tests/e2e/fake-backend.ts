/**
 * A FAKE stand-in for Supabase (sign-in + database) and the YouTube Data API,
 * used ONLY by the end-to-end tests so they can run without real accounts.
 *
 * What it proves: the screens, sign-in flow, protected pages, saving, offline
 * queue, search, import/export and "same library on a second device" all work.
 * What it does NOT prove: real Supabase behaviour, real Row Level Security
 * (that is tested separately against the real migration in tests/db), Google
 * sign-in, or real YouTube results.
 *
 * It reuses the app's own pure `applyOp` logic so library changes behave the same.
 */
import { createHmac, randomUUID } from "node:crypto";
import http from "node:http";
import { applyOp, type Op } from "../../src/lib/library/ops";
import { DEFAULT_SETTINGS, EMPTY_LIBRARY, type LibraryState, type Track } from "../../src/lib/types";

const PORT = Number(process.env.FAKE_BACKEND_PORT ?? 54399);
const JWT_SECRET = "fake-secret-for-tests-only";

interface FakeUser {
  id: string;
  email: string;
  password: string;
  providers: string[];
}

const users = new Map<string, FakeUser>(); // by email
const refreshTokens = new Map<string, string>(); // token -> user id
const libraries = new Map<string, LibraryState>(); // by user id
/** Test hook: when set, every database call fails with this HTTP status (simulates an outage). */
let forcedDbStatus: number | null = null;
const requestLog: string[] = [];

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

function signJwt(user: FakeUser): string {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({
    iss: `http://127.0.0.1:${PORT}/auth/v1`,
    aud: "authenticated",
    role: "authenticated",
    sub: user.id,
    email: user.email,
    iat: now,
    exp: now + 3600,
    session_id: randomUUID(),
    is_anonymous: false,
  });
  const sig = createHmac("sha256", JWT_SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

function verifyJwt(token: string): { sub: string } | null {
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return null;
  const expected = createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url");
  if (expected !== s) return null;
  const payload = JSON.parse(Buffer.from(p, "base64url").toString());
  if (payload.exp < Date.now() / 1000) return null;
  return payload;
}

const userJson = (u: FakeUser) => ({
  id: u.id,
  aud: "authenticated",
  role: "authenticated",
  email: u.email,
  email_confirmed_at: new Date().toISOString(),
  app_metadata: { provider: u.providers[0], providers: u.providers },
  user_metadata: {},
  identities: u.providers.map((provider) => ({ provider, identity_id: randomUUID(), user_id: u.id })),
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

function sessionFor(u: FakeUser) {
  const refresh = randomUUID();
  refreshTokens.set(refresh, u.id);
  return {
    access_token: signJwt(u),
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: refresh,
    user: userJson(u),
  };
}

const library = (userId: string) => {
  let lib = libraries.get(userId);
  if (!lib) {
    lib = { ...EMPTY_LIBRARY, settings: { ...DEFAULT_SETTINGS } };
    libraries.set(userId, lib);
  }
  return lib;
};

// ---------------------------------------------------------------- HTTP helpers

function send(res: http.ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}) {
  const text = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(text);
}

async function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function authUser(req: http.IncomingMessage): FakeUser | null {
  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const claims = verifyJwt(token);
  if (!claims) return null;
  return [...users.values()].find((u) => u.id === claims.sub) ?? null;
}

// ---------------------------------------------------------------- auth (GoTrue)

async function handleAuth(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const path = url.pathname.replace("/auth/v1", "");
  const body = await readBody(req);

  if (path === "/signup" && req.method === "POST") {
    const email = String(body.email ?? "").toLowerCase();
    if (!email || String(body.password ?? "").length < 8) {
      return send(res, 422, {
        code: 422,
        error_code: "weak_password",
        msg: "Password should be at least 8 characters.",
      });
    }
    if (users.has(email)) {
      // Real Supabase hides whether the address exists; it answers as if signup worked.
      return send(res, 200, { ...userJson(users.get(email)!), identities: [] });
    }
    const user: FakeUser = { id: randomUUID(), email, password: String(body.password), providers: ["email"] };
    users.set(email, user);
    // Emails containing "+confirm" behave like a project with email confirmation ON.
    if (email.includes("+confirm")) return send(res, 200, userJson(user));
    return send(res, 200, sessionFor(user));
  }

  if (path === "/token" && req.method === "POST") {
    const grant = url.searchParams.get("grant_type");
    if (grant === "password") {
      const user = users.get(String(body.email ?? "").toLowerCase());
      if (!user || user.password !== body.password) {
        return send(res, 400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
      }
      return send(res, 200, sessionFor(user));
    }
    if (grant === "refresh_token") {
      const id = refreshTokens.get(String(body.refresh_token));
      const user = [...users.values()].find((u) => u.id === id);
      if (!user)
        return send(res, 400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" });
      return send(res, 200, sessionFor(user));
    }
  }

  if (path === "/user") {
    const user = authUser(req);
    if (!user) return send(res, 401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
    if (req.method === "PUT") {
      if (typeof body.password === "string") {
        if (body.password.length < 8)
          return send(res, 422, {
            code: 422,
            error_code: "weak_password",
            msg: "Password should be at least 8 characters.",
          });
        user.password = body.password;
        if (!user.providers.includes("email")) user.providers.push("email");
      }
    }
    return send(res, 200, userJson(user));
  }

  if (path === "/logout") return send(res, 204);
  if (path === "/recover") return send(res, 200, {});
  return send(res, 404, { code: 404, msg: `fake auth: no route ${req.method} ${path}` });
}

// ---------------------------------------------------------------- database (PostgREST)

const playlistRows = (lib: LibraryState) =>
  lib.playlists.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
    deleted_at: p.deletedAt,
  }));

const trackRows = (lib: LibraryState) =>
  lib.playlists.flatMap((p) =>
    p.tracks.map((t, i) => ({
      playlist_id: p.id,
      video_id: t.videoId,
      title: t.title,
      channel_title: t.channelTitle,
      thumbnail_url: t.thumbnailUrl,
      duration_seconds: t.durationSeconds,
      position: i + 1,
    })),
  );

const recentRows = (lib: LibraryState) =>
  lib.recent.map((r) => ({
    video_id: r.videoId,
    title: r.title,
    channel_title: r.channelTitle,
    thumbnail_url: r.thumbnailUrl,
    duration_seconds: r.durationSeconds,
    played_at: r.playedAt,
  }));

const trackFrom = (b: Record<string, unknown>): Track => ({
  videoId: String(b.p_video_id),
  title: String(b.p_title),
  channelTitle: String(b.p_channel_title ?? ""),
  thumbnailUrl: (b.p_thumbnail_url as string | null) ?? null,
  durationSeconds: (b.p_duration_seconds as number | null) ?? null,
});

function dbError(res: http.ServerResponse, status: number, code: string, message: string) {
  return send(res, status, { code, message, details: null, hint: null });
}

function selectRows(table: string, lib: LibraryState, url: URL) {
  let rows: Record<string, unknown>[] =
    table === "playlists"
      ? playlistRows(lib)
      : table === "playlist_tracks"
        ? trackRows(lib)
        : table === "recently_played"
          ? recentRows(lib)
          : [
              {
                user_id: "me",
                trash_retention_days: lib.settings.trashRetentionDays,
                shuffle: lib.settings.shuffle,
                repeat_mode: lib.settings.repeatMode,
              },
            ];

  for (const [key, value] of url.searchParams) {
    if (value.startsWith("eq.")) rows = rows.filter((r) => String(r[key]) === value.slice(3) || key === "user_id");
  }
  const order = url.searchParams.getAll("order");
  for (const o of [...order].reverse()) {
    const [col, dir] = o.split(".");
    rows = [...rows].sort((a, b) => {
      const x = a[col] as string | number;
      const y = b[col] as string | number;
      const c = x < y ? -1 : x > y ? 1 : 0;
      return dir === "desc" ? -c : c;
    });
  }
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const limit = url.searchParams.get("limit");
  rows = rows.slice(offset, limit ? offset + Number(limit) : undefined);
  return rows;
}

async function handleRest(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const user = authUser(req);
  if (!user) return dbError(res, 401, "PGRST301", "JWT expired or invalid");
  if (forcedDbStatus) return dbError(res, forcedDbStatus, "XX000", "Simulated outage");

  const lib = library(user.id);
  const path = url.pathname.replace("/rest/v1/", "");
  const body = await readBody(req);
  const returnsRows = (req.headers.prefer ?? "").includes("return=representation");

  // ---- functions
  if (path.startsWith("rpc/")) {
    const fn = path.slice(4);
    const at = new Date().toISOString();
    const apply = (op: Op) => libraries.set(user.id, applyOp(library(user.id), op));
    const exists = (id: unknown) => lib.playlists.some((p) => p.id === id && !p.deletedAt);
    const needPlaylist = (id: unknown) => (exists(id) ? null : dbError(res, 404, "P0002", "playlist_not_found"));

    switch (fn) {
      case "create_playlist":
        apply({ type: "createPlaylist", id: String(body.p_id), name: String(body.p_name), at });
        return send(res, 200, null);
      case "add_track_to_playlist":
        if (needPlaylist(body.p_playlist_id)) return;
        apply({ type: "addTrack", playlistId: String(body.p_playlist_id), track: trackFrom(body), at });
        return send(res, 200, null);
      case "remove_track_from_playlist":
        if (needPlaylist(body.p_playlist_id)) return;
        apply({ type: "removeTrack", playlistId: String(body.p_playlist_id), videoId: String(body.p_video_id), at });
        return send(res, 200, null);
      case "reorder_playlist_tracks":
        if (needPlaylist(body.p_playlist_id)) return;
        apply({
          type: "reorderTracks",
          playlistId: String(body.p_playlist_id),
          videoIds: body.p_video_ids as string[],
          at,
        });
        return send(res, 200, null);
      case "duplicate_playlist":
        if (needPlaylist(body.p_source_id)) return;
        apply({
          type: "duplicatePlaylist",
          sourceId: String(body.p_source_id),
          newId: String(body.p_new_id),
          name: String(body.p_new_name),
          at,
        });
        return send(res, 200, null);
      case "record_play":
        apply({ type: "recordPlay", track: trackFrom(body), at });
        return send(res, 200, null);
      case "purge_expired_playlists":
        return send(res, 200, 0);
      case "import_playlist": {
        const id = String(body.p_id);
        apply({ type: "createPlaylist", id, name: String(body.p_name), at });
        for (const t of body.p_tracks as Record<string, unknown>[]) {
          apply({
            type: "addTrack",
            playlistId: id,
            at,
            track: {
              videoId: String(t.video_id),
              title: String(t.title),
              channelTitle: String(t.channel_title ?? ""),
              thumbnailUrl: (t.thumbnail_url as string | null) ?? null,
              durationSeconds: (t.duration_seconds as number | null) ?? null,
            },
          });
        }
        return send(res, 200, id);
      }
    }
    return dbError(res, 404, "PGRST202", `no function ${fn}`);
  }

  // ---- tables
  const table = path;
  if (req.method === "GET") return send(res, 200, selectRows(table, lib, url));

  if (req.method === "PATCH") {
    if (table === "playlists") {
      const id = (url.searchParams.get("id") ?? "").replace("eq.", "");
      const p = lib.playlists.find((x) => x.id === id);
      if (!p) return send(res, 200, []);
      const at = new Date().toISOString();
      if ("name" in body) apply(user.id, { type: "renamePlaylist", id, name: String(body.name), at });
      if ("deleted_at" in body) {
        apply(
          user.id,
          body.deleted_at
            ? { type: "softDeletePlaylist", id, at: String(body.deleted_at) }
            : { type: "restorePlaylist", id, at },
        );
      }
      return send(res, 200, returnsRows ? [{ id }] : undefined);
    }
    if (table === "user_settings") {
      const patch: Partial<LibraryState["settings"]> = {};
      if ("trash_retention_days" in body) patch.trashRetentionDays = Number(body.trash_retention_days);
      if ("shuffle" in body) patch.shuffle = Boolean(body.shuffle);
      if ("repeat_mode" in body) patch.repeatMode = body.repeat_mode as "off" | "all" | "one";
      apply(user.id, { type: "updateSettings", patch });
      return send(res, 200, returnsRows ? [{ user_id: user.id }] : undefined);
    }
  }

  if (req.method === "DELETE" && table === "playlists") {
    const id = (url.searchParams.get("id") ?? "").replace("eq.", "");
    const p = lib.playlists.find((x) => x.id === id);
    if (!p || !p.deletedAt) return send(res, 200, []);
    apply(user.id, { type: "permanentDeletePlaylist", id });
    return send(res, 200, returnsRows ? [{ id }] : undefined);
  }

  return dbError(res, 404, "PGRST205", `fake rest: no route ${req.method} ${table}`);
}

function apply(userId: string, op: Op) {
  libraries.set(userId, applyOp(library(userId), op));
}

// ---------------------------------------------------------------- YouTube Data API (fake)

const CATALOG: Record<
  string,
  { id: string; title: string; channel: string; duration: string; embeddable?: boolean }[]
> = {
  lofi: [
    { id: "aaaaaaaaaa1", title: "Lofi Study Beats", channel: "Chill Channel", duration: "PT3M20S" },
    { id: "aaaaaaaaaa2", title: "Rainy Day Lofi", channel: "Chill Channel", duration: "PT2M45S" },
    { id: "aaaaaaaaaa3", title: "Midnight Coffee", channel: "Night Owl", duration: "PT1H2M3S" },
  ],
  jazz: [
    { id: "bbbbbbbbbb1", title: "Blue Jazz Evening", channel: "Jazz Club", duration: "PT4M10S" },
    { id: "bbbbbbbbbb2", title: "Smooth Saxophone", channel: "Jazz Club", duration: "PT5M" },
  ],
};

function handleYouTube(res: http.ServerResponse, url: URL) {
  if (url.searchParams.get("key") === "bad-key") {
    return send(res, 400, { error: { code: 400, message: "API key not valid.", errors: [{ reason: "keyInvalid" }] } });
  }
  const term = (url.searchParams.get("q") ?? "").toLowerCase();
  if (url.pathname.endsWith("/search")) {
    if (term.includes("quota")) {
      return send(res, 403, { error: { code: 403, message: "quota", errors: [{ reason: "quotaExceeded" }] } });
    }
    const hits = Object.entries(CATALOG).find(([k]) => term.includes(k))?.[1] ?? [];
    return send(res, 200, { items: hits.map((h) => ({ id: { videoId: h.id } })) });
  }
  if (url.pathname.endsWith("/videos")) {
    const ids = (url.searchParams.get("id") ?? "").split(",");
    const all = Object.values(CATALOG).flat();
    return send(res, 200, {
      items: ids
        .map((id) => all.find((v) => v.id === id))
        .filter((v): v is NonNullable<typeof v> => Boolean(v))
        .map((v) => ({
          id: v.id,
          snippet: { title: v.title, channelTitle: v.channel },
          contentDetails: { duration: v.duration },
          status: { embeddable: true, privacyStatus: "public" },
        })),
    });
  }
  return send(res, 404, {});
}

// ---------------------------------------------------------------- server

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);

  // CORS so the browser (a different port) may call it.
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin ?? "*");
  res.setHeader("Access-Control-Allow-Headers", req.headers["access-control-request-headers"] ?? "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  try {
    if (url.pathname === "/health") return send(res, 200, { ok: true });

    // Test controls
    if (url.pathname === "/__test/db-outage") {
      forcedDbStatus = url.searchParams.get("status") ? Number(url.searchParams.get("status")) : null;
      return send(res, 200, { forcedDbStatus });
    }
    if (url.pathname === "/__test/reset") {
      users.clear();
      libraries.clear();
      refreshTokens.clear();
      forcedDbStatus = null;
      return send(res, 200, { ok: true });
    }
    if (url.pathname === "/__test/library") {
      const user = users.get(url.searchParams.get("email") ?? "");
      return send(res, 200, user ? library(user.id) : null);
    }

    requestLog.push(`${req.method} ${url.pathname}`);
    if (requestLog.length > 500) requestLog.shift();

    if (url.pathname.startsWith("/auth/v1")) return await handleAuth(req, res, url);
    if (url.pathname.startsWith("/rest/v1")) return await handleRest(req, res, url);
    if (url.pathname.startsWith("/youtube/v3")) return handleYouTube(res, url);
    return send(res, 404, { error: "fake backend: unknown route" });
  } catch (err) {
    console.error("[fake-backend] error", err);
    return send(res, 500, { error: "fake backend crashed" });
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`[fake-backend] listening on ${PORT}`));
