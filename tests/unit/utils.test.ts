import { describe, expect, it } from "vitest";
import { createRateLimiter } from "@/lib/rateLimit";
import { safeNextPath } from "@/lib/safeNext";
import { thumbnailFor } from "@/lib/thumbnail";
import { isSameOrigin } from "@/lib/csrf";
import { formatDuration, formatTotalDuration, timeAgo } from "@/lib/format";
import { toRemoteError } from "@/lib/library/errors";

describe("rate limiter", () => {
  it("allows up to the limit, then blocks with a retry time, then recovers", () => {
    const rl = createRateLimiter(3, 1000);
    expect(rl.check("u", 0).ok).toBe(true);
    expect(rl.check("u", 100).ok).toBe(true);
    expect(rl.check("u", 200).ok).toBe(true);
    const blocked = rl.check("u", 300);
    expect(blocked).toEqual({ ok: false, retryAfterSeconds: 1 });
    expect(rl.check("u", 1001).ok).toBe(true);
  });

  it("tracks each user separately", () => {
    const rl = createRateLimiter(1, 1000);
    expect(rl.check("a", 0).ok).toBe(true);
    expect(rl.check("b", 0).ok).toBe(true);
    expect(rl.check("a", 1).ok).toBe(false);
  });

  it("does not grow without bound", () => {
    const rl = createRateLimiter(1, 60_000, 10);
    for (let i = 0; i < 100; i++) rl.check(`u${i}`, i);
    expect(rl.check("u0", 200).ok).toBe(true); // oldest was evicted
  });
});

describe("safeNextPath (open-redirect protection)", () => {
  it.each([
    ["/playlists", "/playlists"],
    ["/search?q=a", "/search?q=a"],
    [null, "/"],
    ["", "/"],
    ["https://evil.example", "/"],
    ["//evil.example", "/"],
    ["/\\evil.example", "/"],
    ["javascript:alert(1)", "/"],
    ["/ok\nSet-Cookie: x=1", "/"],
  ])("%s -> %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});

describe("thumbnailFor", () => {
  it("keeps YouTube image hosts and replaces anything else", () => {
    const id = "abcdefghijk";
    expect(thumbnailFor({ videoId: id, thumbnailUrl: "https://i.ytimg.com/vi/x/hq.jpg" })).toBe(
      "https://i.ytimg.com/vi/x/hq.jpg",
    );
    for (const bad of ["https://evil.example/t.gif", "http://i.ytimg.com/x.jpg", "not a url", null]) {
      expect(thumbnailFor({ videoId: id, thumbnailUrl: bad })).toBe(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
    }
  });
});

describe("isSameOrigin", () => {
  const req = (headers: Record<string, string>) =>
    new Request("https://app.example/api/import", { method: "POST", headers });
  it("accepts same-site and header-less requests, rejects other sites", () => {
    expect(isSameOrigin(req({ origin: "https://app.example", host: "app.example" }))).toBe(true);
    expect(isSameOrigin(req({ host: "app.example" }))).toBe(true);
    expect(isSameOrigin(req({ origin: "https://evil.example", host: "app.example" }))).toBe(false);
    expect(isSameOrigin(req({ origin: "null", host: "app.example" }))).toBe(false);
  });
});

describe("formatting", () => {
  it("formats durations", () => {
    expect(formatDuration(215)).toBe("3:35");
    expect(formatDuration(3725)).toBe("1:02:05");
    expect(formatDuration(null)).toBe("");
    expect(formatTotalDuration(5400)).toBe("1 hr 30 min");
    expect(formatTotalDuration(30)).toBe("1 min");
  });
  it("formats relative time", () => {
    const now = Date.parse("2026-10-15T12:00:00Z");
    expect(timeAgo("2026-10-15T11:59:50Z", now)).toBe("just now");
    expect(timeAgo("2026-10-15T11:30:00Z", now)).toBe("30 min ago");
    expect(timeAgo("2026-10-13T12:00:00Z", now)).toBe("2 days ago");
  });
});

describe("error classification", () => {
  it("separates temporary, session and permanent problems", () => {
    expect(toRemoteError(new TypeError("Failed to fetch")).kind).toBe("network");
    expect(toRemoteError({ message: "x" }, 503).kind).toBe("network");
    expect(toRemoteError({ message: "x" }, 429).kind).toBe("network");
    expect(toRemoteError({ message: "JWT expired", code: "PGRST301" }, 401).kind).toBe("auth");
    const refused = toRemoteError({ message: "playlist_not_found", code: "P0002" }, 400);
    expect(refused.kind).toBe("permanent");
    expect(refused.message).toBe("That playlist no longer exists.");
    expect(toRemoteError({ message: "violates row-level security policy", code: "42501" }, 403).message).toMatch(
      /permission/i,
    );
  });
  it("does not expose raw database messages", () => {
    expect(
      toRemoteError({ message: 'relation "secret_table" does not exist', code: "42P01" }, 400).message,
    ).not.toMatch(/secret_table/);
  });
});
