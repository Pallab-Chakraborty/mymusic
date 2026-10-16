import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

let claims: { sub: string } | null = null;
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getClaims: async () => ({ data: claims ? { claims } : null }) } }),
}));

import { isPublicPath, updateSession } from "@/lib/supabase/session";

const req = (path: string) => new NextRequest(`https://app.example${path}`);
const location = (res: Response) => (res.headers.get("location") ? new URL(res.headers.get("location")!) : null);

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  claims = null;
});
afterEach(() => vi.unstubAllEnvs());

describe("signed-out visitors", () => {
  it.each(["/", "/search", "/library", "/playlists", "/playlists/abc", "/recent", "/settings", "/trash"])(
    "are sent to the login page from %s",
    async (path) => {
      const res = await updateSession(req(path));
      expect(res.status).toBe(307);
      expect(location(res)!.pathname).toBe("/login");
    },
  );

  it("come back to the page they wanted after signing in", async () => {
    const res = await updateSession(req("/playlists/abc?x=1"));
    expect(location(res)!.searchParams.get("next")).toBe("/playlists/abc?x=1");
  });

  it.each(["/login", "/register", "/forgot-password", "/auth/callback", "/auth/update-password", "/setup-needed"])(
    "can open the public page %s",
    async (path) => {
      expect((await updateSession(req(path))).status).toBe(200);
    },
  );

  it("API routes answer for themselves (401 JSON) instead of redirecting", async () => {
    expect((await updateSession(req("/api/search?q=a"))).status).toBe(200);
  });
});

describe("signed-in users", () => {
  beforeEach(() => {
    claims = { sub: "user-1" };
  });

  it.each(["/", "/search", "/library", "/playlists", "/settings"])("can open %s", async (path) => {
    expect((await updateSession(req(path))).status).toBe(200);
  });

  it.each(["/login", "/register", "/forgot-password"])("are sent home from %s", async (path) => {
    const res = await updateSession(req(path));
    expect(res.status).toBe(307);
    expect(location(res)!.pathname).toBe("/");
  });

  it("can still reach the password-update page", async () => {
    expect((await updateSession(req("/auth/update-password"))).status).toBe(200);
  });
});

describe("before Supabase is configured", () => {
  it("shows the setup page instead of crashing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const res = await updateSession(req("/playlists"));
    expect(location(res)!.pathname).toBe("/setup-needed");
  });
});

describe("isPublicPath", () => {
  it("is exact for pages and prefix-based only for /auth/", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/login/extra")).toBe(false);
    expect(isPublicPath("/auth/callback")).toBe(true);
    expect(isPublicPath("/authorized")).toBe(false);
    expect(isPublicPath("/playlists")).toBe(false);
  });
});
