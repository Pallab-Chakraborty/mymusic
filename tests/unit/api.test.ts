import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const SECRET = "AIza-SECRET-KEY-456";

// --- stand-in for the signed-in Supabase session ---------------------------
let claims: { sub: string } | null = { sub: "user-a" };
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getClaims: async () => ({ data: claims ? { claims } : null }) },
    rpc,
  }),
}));

import { GET as search } from "@/app/api/search/route";
import { POST as importRoute } from "@/app/api/import/route";

const ID = "aaaaaaaaaaa";
const googleOk = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

function stubGoogleSuccess() {
  const fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes("/search")) return googleOk({ items: [{ id: { videoId: ID } }] });
    return googleOk({
      items: [
        {
          id: ID,
          snippet: { title: "Hello", channelTitle: "Adele" },
          contentDetails: { duration: "PT4M55S" },
          status: { embeddable: true, privacyStatus: "public" },
        },
      ],
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const searchReq = (q?: string) =>
  new NextRequest(`https://app.example/api/search${q === undefined ? "" : `?q=${encodeURIComponent(q)}`}`);

let uid = 0;
beforeEach(() => {
  claims = { sub: `user-${++uid}` };
  vi.stubEnv("YOUTUBE_API_KEY", SECRET);
  rpc.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/search", () => {
  it("requires sign-in", async () => {
    claims = null;
    const res = await search(searchReq("hello"));
    expect(res.status).toBe(401);
  });

  it.each([[undefined], [""], ["   "], ["x".repeat(101)]])("rejects bad queries (%s)", async (q) => {
    const res = await search(searchReq(q));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_query");
  });

  it("says plainly when the server has no API key", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "");
    const res = await search(searchReq("hello"));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("not_configured");
  });

  it("returns results and does not cache in the browser", async () => {
    stubGoogleSuccess();
    const res = await search(searchReq("hello unique-1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = await res.json();
    expect(body.results).toEqual([
      expect.objectContaining({ videoId: ID, title: "Hello", channelTitle: "Adele", durationSeconds: 295 }),
    ]);
  });

  it("serves repeat searches from memory to save YouTube quota", async () => {
    const f = stubGoogleSuccess();
    await search(searchReq("repeat me"));
    const callsAfterFirst = f.mock.calls.length;
    const second = await search(searchReq("REPEAT ME"));
    expect((await second.json()).cached).toBe(true);
    expect(f.mock.calls.length).toBe(callsAfterFirst);
  });

  it("shows a friendly message when the daily quota is used up, without leaking anything", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: { code: 403, message: `quota ${SECRET}`, errors: [{ reason: "quotaExceeded" }] } }),
            { status: 403 },
          ),
      ),
    );
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await search(searchReq("quota test"));
    const text = await res.text();
    expect(res.status).toBe(429);
    expect(text).toMatch(/daily limit/i);
    expect(text).not.toContain(SECRET);
    expect(JSON.stringify(spy.mock.calls)).not.toContain(SECRET);
  });

  it("reports an invalid key as a server problem, not a user problem, without leaking it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: { code: 400, message: "API key not valid", errors: [{ reason: "badRequest" }] } }),
            { status: 400 },
          ),
      ),
    );
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await search(searchReq("badkey test"));
    const text = await res.text();
    expect(res.status).toBe(503);
    expect(JSON.parse(text).error).toBe("invalid_key");
    expect(text).not.toContain(SECRET);
    expect(JSON.stringify(spy.mock.calls)).not.toContain(SECRET);
  });

  it("handles network failure to YouTube", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError(`fetch failed ?key=${SECRET}`);
      }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await search(searchReq("net test"));
    const text = await res.text();
    expect(res.status).toBe(502);
    expect(text).not.toContain(SECRET);
  });

  it("limits how fast one user can search", async () => {
    stubGoogleSuccess();
    claims = { sub: "heavy-user" };
    let last: Response | undefined;
    for (let i = 0; i < 21; i++) last = await search(searchReq(`flood ${i}`));
    expect(last!.status).toBe(429);
    expect(last!.headers.get("retry-after")).toBeTruthy();
    expect((await last!.json()).error).toBe("rate_limited");
    // another user is unaffected
    claims = { sub: "other-user" };
    expect((await search(searchReq("flood 0"))).status).toBe(200);
  });
});

describe("POST /api/import", () => {
  const goodFile = {
    format: "mymusic-playlists",
    version: 1,
    playlists: [
      {
        name: "Road trip",
        description: null,
        tracks: [
          {
            videoId: ID,
            title: "Hello",
            channelTitle: "Adele",
            durationSeconds: 295,
            thumbnailUrl: "https://evil.example/x.gif",
          },
        ],
      },
      { name: "Empty", tracks: [] },
    ],
  };
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    new NextRequest("https://app.example/api/import", {
      method: "POST",
      headers: { "content-type": "application/json", host: "app.example", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  it("blocks requests from other websites", async () => {
    const res = await importRoute(post(goodFile, { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("requires JSON and sign-in", async () => {
    expect((await importRoute(post("x", { "content-type": "text/plain" }))).status).toBe(415);
    claims = null;
    expect((await importRoute(post(goodFile))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects broken JSON, wrong files and oversized files", async () => {
    expect((await importRoute(post("{not json"))).status).toBe(400);
    const wrong = await importRoute(post({ hello: "world" }));
    expect(wrong.status).toBe(400);
    expect((await wrong.json()).error).toMatch(/MyMusic backup/);
    expect((await importRoute(post(goodFile, { "content-length": String(3 * 1024 * 1024) }))).status).toBe(413);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("saves each playlist through the database function and reports only what was confirmed", async () => {
    rpc.mockResolvedValue({ error: null });
    const res = await importRoute(post(goodFile));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imported.map((p: { name: string; tracks: number }) => [p.name, p.tracks])).toEqual([
      ["Road trip", 1],
      ["Empty", 0],
    ]);
    expect(body.failed).toEqual([]);

    expect(rpc).toHaveBeenCalledTimes(2);
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe("import_playlist");
    expect(args.p_tracks[0]).toEqual({
      video_id: ID,
      title: "Hello",
      channel_title: "Adele",
      duration_seconds: 295,
      thumbnail_url: `https://i.ytimg.com/vi/${ID}/hqdefault.jpg`,
    });
  });

  it("reports partial failure honestly", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { code: "23514", message: "internal detail" } });
    const res = await importRoute(post(goodFile));
    const text = await res.text();
    const body = JSON.parse(text);
    expect(res.status).toBe(200);
    expect(body.imported).toHaveLength(1);
    expect(body.failed).toEqual([{ name: "Empty", error: "Could not be saved." }]);
    expect(text).not.toContain("internal detail");
  });

  it("returns an error status when nothing could be saved", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({ error: { code: "XX000", message: "boom" } });
    const res = await importRoute(post(goodFile));
    expect(res.status).toBe(500);
    expect((await res.json()).imported).toEqual([]);
  });
});
