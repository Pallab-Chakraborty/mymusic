import { describe, expect, it, vi } from "vitest";
import { parseIsoDuration, searchYouTube, YouTubeError } from "@/lib/youtube/search";

const SECRET = "AIza-SECRET-KEY-123";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const err = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const ID1 = "aaaaaaaaaaa";
const ID2 = "bbbbbbbbbbb";
const ID3 = "ccccccccccc";

function fakeFetch(...responses: (Response | Error)[]) {
  const queue = [...responses];
  return vi.fn(async (url: string) => {
    void url;
    const next = queue.shift();
    if (!next) throw new Error("no more responses");
    if (next instanceof Error) throw next;
    return next;
  });
}

describe("parseIsoDuration", () => {
  it.each([
    ["PT3M35S", 215],
    ["PT1H2M3S", 3723],
    ["PT45S", 45],
    ["PT1H", 3600],
    ["P1DT1H", 90000],
    ["P0D", null],
    ["", null],
    ["garbage", null],
  ])("%s -> %s", (input, expected) => {
    expect(parseIsoDuration(input)).toBe(expected);
  });
});

describe("searchYouTube", () => {
  it("returns title, channel, duration and a YouTube thumbnail", async () => {
    const f = fakeFetch(
      ok({ items: [{ id: { videoId: ID1 } }, { id: { videoId: ID2 } }] }),
      ok({
        items: [
          {
            id: ID1,
            snippet: { title: "Song & One", channelTitle: "Artist A" },
            contentDetails: { duration: "PT3M35S" },
            status: { embeddable: true, privacyStatus: "public" },
          },
          {
            id: ID2,
            snippet: { title: "Song Two", channelTitle: "Artist B" },
            contentDetails: { duration: "PT1H" },
            status: { embeddable: true, privacyStatus: "public" },
          },
        ],
      }),
    );
    const results = await searchYouTube("test", SECRET, f);
    expect(results).toEqual([
      {
        videoId: ID1,
        title: "Song & One",
        channelTitle: "Artist A",
        durationSeconds: 215,
        thumbnailUrl: `https://i.ytimg.com/vi/${ID1}/hqdefault.jpg`,
      },
      {
        videoId: ID2,
        title: "Song Two",
        channelTitle: "Artist B",
        durationSeconds: 3600,
        thumbnailUrl: `https://i.ytimg.com/vi/${ID2}/hqdefault.jpg`,
      },
    ]);
  });

  it("drops videos that cannot be embedded or are not public", async () => {
    const f = fakeFetch(
      ok({ items: [{ id: { videoId: ID1 } }, { id: { videoId: ID2 } }, { id: { videoId: ID3 } }] }),
      ok({
        items: [
          { id: ID1, snippet: { title: "Blocked" }, status: { embeddable: false, privacyStatus: "public" } },
          { id: ID2, snippet: { title: "Private" }, status: { embeddable: true, privacyStatus: "private" } },
          { id: ID3, snippet: { title: "Good" }, status: { embeddable: true, privacyStatus: "public" } },
        ],
      }),
    );
    const results = await searchYouTube("x", SECRET, f);
    expect(results.map((r) => r.title)).toEqual(["Good"]);
  });

  it("ignores malformed ids from the API and handles empty results without a second call", async () => {
    const f = fakeFetch(ok({ items: [{ id: { videoId: "bad id!" } }, { id: {} }] }));
    expect(await searchYouTube("x", SECRET, f)).toEqual([]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("maps quota errors", async () => {
    const f = fakeFetch(err(403, { error: { code: 403, message: "quota", errors: [{ reason: "quotaExceeded" }] } }));
    await expect(searchYouTube("x", SECRET, f)).rejects.toMatchObject({ code: "quota_exceeded" });
  });

  it("maps invalid or restricted API keys", async () => {
    for (const body of [
      {
        error: {
          code: 400,
          message: "API key not valid. Please pass a valid API key.",
          errors: [{ reason: "badRequest" }],
        },
      },
      { error: { code: 403, message: "x", errors: [{ reason: "accessNotConfigured" }] } },
      {
        error: {
          code: 403,
          message: "Requests from referer <empty> are blocked.",
          errors: [{ reason: "ipRefererBlocked" }],
        },
      },
    ]) {
      const f = fakeFetch(err(body.error.code, body));
      await expect(searchYouTube("x", SECRET, f)).rejects.toMatchObject({ code: "invalid_key" });
    }
  });

  it("maps network failures and never leaks the key in the error", async () => {
    const f = fakeFetch(new TypeError(`fetch failed: https://www.googleapis.com/youtube/v3/search?key=${SECRET}`));
    const error = await searchYouTube("x", SECRET, f).catch((e) => e);
    expect(error).toBeInstanceOf(YouTubeError);
    expect(error.code).toBe("network");
    expect(String(error.message) + String(error.stack)).not.toContain(SECRET);
  });

  it("maps unexpected server errors and bad bodies", async () => {
    await expect(searchYouTube("x", SECRET, fakeFetch(err(500, {})))).rejects.toMatchObject({ code: "unavailable" });
    await expect(searchYouTube("x", SECRET, fakeFetch(new Response("<html>", { status: 200 })))).rejects.toMatchObject({
      code: "unavailable",
    });
  });

  it("sends the query with the API key to Google only", async () => {
    const f = fakeFetch(ok({ items: [] }));
    await searchYouTube("lofi beats", SECRET, f);
    const url = new URL(f.mock.calls[0][0]);
    expect(url.hostname).toBe("www.googleapis.com");
    expect(url.searchParams.get("q")).toBe("lofi beats");
    expect(url.searchParams.get("videoEmbeddable")).toBe("true");
  });
});
