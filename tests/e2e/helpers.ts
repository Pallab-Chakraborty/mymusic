import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

export const BACKEND = "http://127.0.0.1:54399";
export const PASSWORD = "correct-horse-battery";

/**
 * A stand-in for YouTube's player script, so tests never contact YouTube.
 * It behaves like the real IFrame Player API for the calls the app makes.
 * NOTE: the real YouTube player is therefore NOT exercised by these tests.
 */
const FAKE_IFRAME_API = `
(function () {
  function Player(el, opts) {
    var self = this;
    this.opts = opts; this.state = -1; this.t = 0; this.vid = opts.videoId;
    el.innerHTML = '<div data-testid="fake-yt" style="width:100%;height:100%;background:#000;color:#fff">FAKE PLAYER</div>';
    window.__yt = this;
    setTimeout(function () { if (!window.__ytBlockAutoplay) self._set(1); }, 30);
  }
  Player.prototype._set = function (s) { this.state = s; this.opts.events.onStateChange({ data: s, target: this }); };
  Player.prototype.loadVideoById = function (id) { this.vid = id; this.t = 0; var self=this; setTimeout(function(){ if (!window.__ytBlockAutoplay) self._set(1); }, 30); };
  Player.prototype.playVideo = function () { this._set(1); };
  Player.prototype.pauseVideo = function () { this._set(2); };
  Player.prototype.stopVideo = function () { this._set(0); };
  Player.prototype.seekTo = function (s) { this.t = s; };
  Player.prototype.getCurrentTime = function () { return this.t; };
  Player.prototype.getDuration = function () { return 200; };
  Player.prototype.getPlayerState = function () { return this.state; };
  Player.prototype.setVolume = function () {};
  Player.prototype.destroy = function () {};
  window.YT = { Player: Player };
  setTimeout(function () { if (window.onYouTubeIframeAPIReady) window.onYouTubeIframeAPIReady(); }, 0);
})();
`;

export async function stubYouTube(context: BrowserContext) {
  await context.route("https://www.youtube.com/iframe_api", (route) =>
    route.fulfill({ contentType: "application/javascript", body: FAKE_IFRAME_API }),
  );
  // Thumbnails: answer locally so tests don't need internet.
  await context.route(/https:\/\/i\.ytimg\.com\/.*/, (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="#2b2457"/></svg>',
    }),
  );
}

export async function resetBackend() {
  await fetch(`${BACKEND}/__test/reset`);
}

export const uniqueEmail = (tag = "user") => `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

export async function register(page: Page, email: string, password = PASSWORD) {
  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "What do you want to listen to?" })).toBeVisible();
}

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "What do you want to listen to?" })).toBeVisible();
}

export async function newDevice(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  await stubYouTube(context);
  return { context, page: await context.newPage() };
}

export async function search(page: Page, term: string) {
  await page.goto("/search");
  await page.getByRole("searchbox", { name: "Search YouTube" }).fill(term);
  await page.getByRole("button", { name: "Search", exact: true }).click();
}

export async function cloudLibrary(email: string) {
  const res = await fetch(`${BACKEND}/__test/library?email=${encodeURIComponent(email)}`);
  return (await res.json()) as {
    playlists: { id: string; name: string; deletedAt: string | null; tracks: { videoId: string }[] }[];
    recent: { videoId: string }[];
  } | null;
}

/** Wait until the header says everything is saved. */
export async function expectSaved(page: Page) {
  await expect(page.getByRole("link", { name: /Cloud save status: Saved/ })).toBeVisible({ timeout: 15_000 });
}

/** App alerts only (Next.js also has an invisible route-announcer with role="alert"). */
export const alertBox = (page: Page) => page.locator('[role="alert"]:not(#__next-route-announcer__)');

/** The + / tick button on a song row. Its name changes to "…is saved" once the song is in a playlist. */
export const addButton = (page: Page, title: string) =>
  page.getByRole("button", {
    name: new RegExp(`^(Add ${title} to a playlist|${title} is saved\\. Add to another playlist)$`),
  });
