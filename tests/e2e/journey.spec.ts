import { expect, test } from "@playwright/test";
import {
  PASSWORD,
  cloudLibrary,
  expectSaved,
  login,
  newDevice,
  register,
  resetBackend,
  search,
  stubYouTube,
  uniqueEmail,
  BACKEND,
  alertBox,
  addButton,
} from "./helpers";

test.beforeEach(async ({ context }) => {
  await resetBackend();
  await stubYouTube(context);
});

test.describe("sign-in and protected pages", () => {
  test("signed-out visitors are sent to the login page, and back after signing in", async ({ page }) => {
    await page.goto("/playlists");
    await expect(page).toHaveURL(/\/login\?next=%2Fplaylists/);
    const email = uniqueEmail();
    await fetch(`${BACKEND}/auth/v1/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/playlists$/);
    await expect(page.getByRole("heading", { name: "Playlists", level: 1 })).toBeVisible();
  });

  test("a wrong password shows a clear message and does not sign in", async ({ page }) => {
    const email = uniqueEmail();
    await register(page, email);
    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(alertBox(page)).toContainText("don't match");
    await expect(page).toHaveURL(/\/login/);
  });

  test("an open-redirect attempt in ?next= is ignored", async ({ page }) => {
    const email = uniqueEmail();
    await register(page, email);
    await page.context().clearCookies();
    await page.goto("/login?next=//evil.example.com");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "What do you want to listen to?" })).toBeVisible();
    expect(new URL(page.url()).host).toBe("127.0.0.1:3100");
  });

  test("password reset never reveals whether an address has an account", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill("nobody@example.com");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("status")).toContainText("If an account exists");
  });

  test("registering with an address that needs email confirmation shows the 'check your email' page", async ({
    page,
  }) => {
    await page.goto("/register");
    await page.getByLabel("Email").fill(uniqueEmail("a+confirm"));
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Confirm password").fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  });

  test("mismatched passwords are caught before anything is sent", async ({ page }) => {
    await page.goto("/register");
    await page.getByLabel("Email").fill(uniqueEmail());
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Confirm password").fill("something-else-entirely");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(alertBox(page)).toContainText("don't match");
  });

  test("signing out returns to login and protects the pages again", async ({ page }) => {
    await register(page, uniqueEmail());
    await page.goto("/settings");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/library");
    await expect(page).toHaveURL(/\/login/);
  });
});

test("PRIMARY JOURNEY: register → search → add → create playlist → refresh → same library on a second device", async ({
  page,
  browser,
}) => {
  const email = uniqueEmail();
  await register(page, email);

  // New account starts empty.
  await expect(page.getByText("No playlists yet")).toBeVisible();

  // Search (through the real API route, against the fake YouTube).
  await page.getByRole("searchbox", { name: "Quick search" }).fill("lofi");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/\/search\?q=lofi/);
  await expect(page.getByText("Lofi Study Beats")).toBeVisible();
  await expect(page.getByText("3:20")).toBeVisible(); // duration shown

  // Add to a brand new playlist.
  await addButton(page, "Lofi Study Beats").click();
  await page.getByLabel("New playlist name").fill("Focus");
  await page.getByRole("button", { name: "Create", exact: true }).click();

  // Success is announced only after the cloud confirmed it.
  await expect(page.getByText("Added to Focus")).toBeVisible();
  await expectSaved(page);
  expect((await cloudLibrary(email))?.playlists.map((p) => [p.name, p.tracks.length])).toEqual([["Focus", 1]]);

  // Refresh: still there.
  await page.goto("/playlists");
  await page.reload();
  const card = page.getByRole("link", { name: /Focus/ });
  await expect(card).toContainText("1 song");

  // Second device (separate browser session): sign in and see the same library.
  const second = await newDevice(browser);
  await login(second.page, email);
  await second.page.goto("/playlists");
  await expect(second.page.getByRole("link", { name: /Focus/ })).toContainText("1 song");
  await second.page.getByRole("link", { name: /Focus/ }).click();
  await expect(second.page.getByText("Lofi Study Beats")).toBeVisible();
  await second.context.close();
});

test("two users never see each other's playlists", async ({ page, browser }) => {
  const a = uniqueEmail("a");
  await register(page, a);
  await page.goto("/playlists");
  await page.getByLabel("New playlist name").fill("Private A");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("link", { name: /Private A/ })).toBeVisible();
  await expectSaved(page);

  const other = await newDevice(browser);
  await register(other.page, uniqueEmail("b"));
  await other.page.goto("/playlists");
  await expect(other.page.getByText("No playlists yet")).toBeVisible();
  await expect(other.page.getByText("Private A")).toHaveCount(0);
  await other.context.close();
});

test.describe("search states", () => {
  test("no results, quota exhausted, and retry", async ({ page }) => {
    await register(page, uniqueEmail());
    await search(page, "zzzz nothing");
    await expect(page.getByText("No results for")).toBeVisible();

    await search(page, "quota please");
    await expect(alertBox(page)).toContainText("daily limit");
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  test("offline search explains itself", async ({ page, context }) => {
    await register(page, uniqueEmail());
    await page.goto("/search");
    await context.setOffline(true);
    await page.getByRole("searchbox", { name: "Search YouTube" }).fill("lofi");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(alertBox(page)).toContainText("offline");
  });

  test("search is blocked for signed-out requests", async ({ request }) => {
    const res = await request.get("/api/search?q=lofi");
    expect(res.status()).toBe(401);
  });
});

test.describe("saving, offline and retry", () => {
  test("changes made offline are kept, shown as Offline, and saved once back online", async ({ page, context }) => {
    const email = uniqueEmail();
    await register(page, email);
    await page.goto("/playlists");
    await page.getByLabel("New playlist name").fill("Road trip");
    await page.getByRole("button", { name: "Create" }).click();
    await expectSaved(page);

    await search(page, "jazz");
    await expect(page.getByText("Blue Jazz Evening")).toBeVisible();

    await context.setOffline(true);
    await addButton(page, "Blue Jazz Evening").click();
    await page.getByRole("button", { name: /Road trip/ }).click();

    await expect(page.getByRole("link", { name: /Cloud save status: Offline/ })).toBeVisible();
    // No success message while it is only stored on this device.
    await expect(page.getByText("Added to Road trip")).toHaveCount(0);
    expect((await cloudLibrary(email))?.playlists[0].tracks).toHaveLength(0);

    await context.setOffline(false);
    await expect(page.getByText("Added to Road trip")).toBeVisible({ timeout: 20_000 });
    await expectSaved(page);
    expect((await cloudLibrary(email))?.playlists[0].tracks).toHaveLength(1);
  });

  test("a server outage is retried automatically and nothing is lost", async ({ page }) => {
    const email = uniqueEmail();
    await register(page, email);
    await page.goto("/playlists");
    await fetch(`${BACKEND}/__test/db-outage?status=502`);
    await page.getByLabel("New playlist name").fill("Survives outage");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByRole("link", { name: /Cloud save status: Offline/ })).toBeVisible();
    await expect(page.getByText("Playlist created")).toHaveCount(0);

    await fetch(`${BACKEND}/__test/db-outage`);
    await expectSaved(page);
    await expect(page.getByText("Playlist created")).toBeVisible();
    expect((await cloudLibrary(email))?.playlists.map((p) => p.name)).toEqual(["Survives outage"]);
  });

  test("a pending change survives closing the tab (kept on the device) and is sent on return", async ({
    page,
    context,
  }) => {
    const email = uniqueEmail();
    await register(page, email);
    await page.goto("/playlists");
    await expectSaved(page);
    await context.setOffline(true);
    await page.getByLabel("New playlist name").fill("Written offline");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByRole("link", { name: /Cloud save status: Offline/ })).toBeVisible();
    await page.waitForTimeout(300); // let the local write finish
    await page.close();

    const again = await context.newPage();
    await context.setOffline(false);
    await again.goto("/playlists");
    await expect(again.getByRole("link", { name: /Written offline/ })).toBeVisible();
    await expectSaved(again);
    expect((await cloudLibrary(email))?.playlists.map((p) => p.name)).toEqual(["Written offline"]);
  });
});

test.describe("playlists", () => {
  async function playlistWithTwo(page: import("@playwright/test").Page) {
    await page.goto("/search?q=lofi");
    await addButton(page, "Lofi Study Beats").click();
    await page.getByLabel("New playlist name").fill("Mix");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expectSaved(page);
    await addButton(page, "Rainy Day Lofi").click();
    await page.getByRole("button", { name: /Mix/ }).click();
    await expectSaved(page);
    await page.goto("/playlists");
    await page.getByRole("link", { name: /Mix/ }).click();
    await expect(page.getByRole("heading", { name: "Mix" })).toBeVisible();
  }

  test("rename, reorder, remove, duplicate", async ({ page }) => {
    const email = uniqueEmail();
    await register(page, email);
    await playlistWithTwo(page);

    // order: Lofi Study Beats, Rainy Day Lofi → move the second one up
    await page.getByRole("button", { name: "Move Rainy Day Lofi up" }).click();
    await expectSaved(page);
    await page.reload();
    const titles = page.getByRole("list", { name: "Songs in Mix" }).locator("p.line-clamp-2");
    await expect(titles).toHaveText(["Rainy Day Lofi", "Lofi Study Beats"]);
    expect((await cloudLibrary(email))?.playlists[0].tracks.map((t) => t.videoId)).toEqual([
      "aaaaaaaaaa2",
      "aaaaaaaaaa1",
    ]);

    await page.getByRole("button", { name: "Rename" }).click();
    await page.getByLabel("Playlist name").fill("Mix renamed");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Mix renamed" })).toBeVisible();
    await expect(page.getByText("Playlist renamed")).toBeVisible();

    await page.getByRole("button", { name: "Remove Rainy Day Lofi from this playlist" }).click();
    await expect(page.getByText("Song removed")).toBeVisible();
    await expect(titles).toHaveText(["Lofi Study Beats"]);

    await page.getByRole("button", { name: "Duplicate" }).click();
    await expect(page.getByRole("heading", { name: "Mix renamed (copy)" })).toBeVisible();
    await expectSaved(page);
    expect((await cloudLibrary(email))?.playlists).toHaveLength(2);
  });

  test("adding the same song twice is refused politely (no duplicates)", async ({ page }) => {
    const email = uniqueEmail();
    await register(page, email);
    await page.goto("/search?q=lofi");
    await addButton(page, "Lofi Study Beats").click();
    await page.getByLabel("New playlist name").fill("Once");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expectSaved(page);
    await addButton(page, "Lofi Study Beats").click();
    await page.getByRole("button", { name: /Once/ }).click();
    await expect(page.getByText("Already in Once")).toBeVisible();
    await expectSaved(page);
    expect((await cloudLibrary(email))?.playlists[0].tracks).toHaveLength(1);
  });

  test("delete goes to trash, can be restored, and 'delete forever' needs confirmation", async ({ page }) => {
    const email = uniqueEmail();
    await register(page, email);
    await playlistWithTwo(page);

    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("button", { name: "Move to trash" }).click();
    await expect(page).toHaveURL(/\/playlists$/);
    await expect(page.getByText("Playlist moved to trash")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recently deleted" })).toBeVisible();
    // Still in the cloud, just marked as deleted.
    expect((await cloudLibrary(email))?.playlists[0].deletedAt).not.toBeNull();

    await page.getByRole("button", { name: "Restore" }).click();
    await expect(page.getByText("Playlist restored")).toBeVisible();
    await expect(page.getByRole("link", { name: /Mix/ })).toBeVisible();
    expect((await cloudLibrary(email))?.playlists[0].deletedAt).toBeNull();

    // Delete again, then erase for good (after the warning).
    await page.getByRole("link", { name: /Mix/ }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("button", { name: "Move to trash" }).click();
    await page.getByRole("button", { name: "Delete forever…" }).click();
    await expect(page.getByText("This cannot be undone.")).toBeVisible();
    await page.getByRole("button", { name: "Keep it" }).click();
    expect((await cloudLibrary(email))?.playlists).toHaveLength(1);
    await page.getByRole("button", { name: "Delete forever…" }).click();
    await page.getByRole("button", { name: "Delete forever", exact: true }).click();
    await expect(page.getByText("Playlist deleted permanently")).toBeVisible();
    expect((await cloudLibrary(email))?.playlists).toHaveLength(0);
  });

  test("find and sort songs inside a playlist; sorting never changes your order until you keep it", async ({
    page,
  }) => {
    const email = uniqueEmail();
    await register(page, email);
    await playlistWithTwo(page); // Mix: Lofi Study Beats, Rainy Day Lofi
    const rows = page.getByRole("list", { name: "Songs in Mix" }).getByRole("listitem");

    await page.getByLabel("Find a song in this playlist").fill("rainy");
    await expect(rows).toHaveCount(1);
    await expect(page.getByRole("status").filter({ hasText: "1 of 2 songs match" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Drag to reorder/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Reset" }).click();
    await expect(rows).toHaveCount(2);

    await page.getByLabel("Sort by").selectOption({ label: "Title Z → A" });
    await expect(rows.first()).toContainText("Rainy Day Lofi");
    // Only a view: the saved order is untouched.
    expect((await cloudLibrary(email))?.playlists[0].tracks[0].videoId).toBeTruthy();
    const before = (await cloudLibrary(email))?.playlists[0].tracks.map((t) => t.videoId);

    await page.getByRole("button", { name: "Keep this order" }).click();
    await expectSaved(page);
    const after = (await cloudLibrary(email))?.playlists[0].tracks.map((t) => t.videoId);
    expect(after).toEqual([...(before ?? [])].reverse());
    await page.reload();
    await expect(rows.first()).toContainText("Rainy Day Lofi");
  });

  test("My Library lists every saved song once and filters instantly", async ({ page }) => {
    await register(page, uniqueEmail());
    await playlistWithTwo(page);
    await page.goto("/library");
    await expect(page.getByText("2 saved songs across 1 playlists")).toBeVisible();
    await page.getByRole("searchbox", { name: "Search your library" }).fill("rainy");
    await expect(page.getByText("Rainy Day Lofi")).toBeVisible();
    await expect(page.getByText("Lofi Study Beats")).toHaveCount(0);
  });
});

test.describe("export, import and restore", () => {
  test("export JSON and M3U, then import the JSON back as a new playlist", async ({ page }) => {
    const email = uniqueEmail();
    await register(page, email);
    await page.goto("/search?q=jazz");
    await addButton(page, "Blue Jazz Evening").click();
    await page.getByLabel("New playlist name").fill("Jazz");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expectSaved(page);

    await page.goto("/playlists");
    await page.getByRole("link", { name: /Jazz/ }).click();

    const [json] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export JSON" }).click(),
    ]);
    const jsonPath = await json.path();
    const fs = await import("node:fs");
    const exported = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    expect(exported.format).toBe("mymusic-playlists");
    expect(exported.playlists[0].tracks[0].videoId).toBe("bbbbbbbbbb1");

    const [m3u] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export M3U" }).click(),
    ]);
    const m3uText = fs.readFileSync(await m3u.path(), "utf8");
    expect(m3uText).toContain("#EXTM3U");
    expect(m3uText).toContain("#MYMUSIC:videoId=bbbbbbbbbb1");
    expect(m3uText).toContain("https://www.youtube.com/watch?v=bbbbbbbbbb1");

    // Import it back.
    await page.goto("/settings");
    await page.getByLabel("Choose a MyMusic backup file").setInputFiles(jsonPath);
    await expect(page.getByText("Imported 1 playlist (1 songs).")).toBeVisible();
    expect((await cloudLibrary(email))?.playlists).toHaveLength(2);
  });

  test("a file that isn't a MyMusic backup is rejected and nothing changes", async ({ page }) => {
    const email = uniqueEmail();
    await register(page, email);
    await page.goto("/settings");
    await page.getByLabel("Choose a MyMusic backup file").setInputFiles({
      name: "bad.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ hello: "world" })),
    });
    await expect(alertBox(page)).toContainText("doesn't look like a MyMusic backup");
    expect((await cloudLibrary(email))?.playlists ?? []).toHaveLength(0);
  });

  test("cross-site import requests are blocked", async ({ request }) => {
    const res = await request.post("/api/import", {
      headers: { Origin: "https://evil.example.com", "Content-Type": "application/json" },
      data: {},
    });
    expect(res.status()).toBe(403);
  });
});

test.describe("playback (with a stand-in for YouTube's player)", () => {
  test("play shows the player at a compliant size, records recently played, and next/pause work", async ({ page }) => {
    const email = uniqueEmail();
    await register(page, email);
    await search(page, "lofi");
    await page.getByRole("button", { name: "Play Lofi Study Beats" }).click();

    const player = page.getByLabel("YouTube video player");
    await expect(player).toBeVisible();
    // YouTube requires the embedded player to be at least 200x200 and never hidden.
    const box = await player.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(200);
    expect(box!.height).toBeGreaterThanOrEqual(200);

    await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Play", exact: true }).click();

    await page.getByRole("button", { name: "Next song" }).click();
    await expect(page.getByRole("button", { name: /Open player: Rainy Day Lofi/ })).toBeVisible();

    // Recently played is stored in the cloud, newest first.
    await expect
      .poll(async () => (await cloudLibrary(email))?.recent.map((r) => r.videoId))
      .toEqual(["aaaaaaaaaa2", "aaaaaaaaaa1"]);
    await page.goto("/recent");
    await expect(page.getByText("Rainy Day Lofi").first()).toBeVisible();
  });

  test("expanded player: seek, queue management, and the honest limitations note", async ({ page }) => {
    await register(page, uniqueEmail());
    await search(page, "lofi");
    await page.getByRole("button", { name: "Play Lofi Study Beats" }).click();
    await page.getByRole("button", { name: "Open full player" }).click();

    const dialog = page.getByRole("dialog", { name: "Player" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("may pause playback when the screen locks")).toBeVisible();
    await expect(dialog.getByRole("slider", { name: "Seek" })).toBeVisible();

    const queue = dialog.getByRole("list", { name: "Songs in the queue" });
    await expect(queue.getByRole("listitem")).toHaveCount(3);
    await dialog.getByRole("button", { name: "Remove Midnight Coffee from the queue" }).click();
    await expect(queue.getByRole("listitem")).toHaveCount(2);
    await dialog.getByRole("button", { name: "Move Rainy Day Lofi up" }).click();
    await expect(queue.getByRole("listitem").first()).toContainText("Rainy Day Lofi");

    // Video stays visible in the expanded view too.
    const box = await page.getByLabel("YouTube video player").boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(200);
    expect(box!.height).toBeGreaterThanOrEqual(200);

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("a blocked embed shows a clear message and the player keeps working", async ({ page }) => {
    await register(page, uniqueEmail());
    await search(page, "jazz");
    await page.getByRole("button", { name: "Play Blue Jazz Evening" }).click();
    await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
    await page.evaluate(() => {
      const w = window as unknown as { __yt: { opts: { events: { onError: (e: { data: number }) => void } } } };
      w.__yt.opts.events.onError({ data: 101 });
    });
    await expect(alertBox(page).filter({ hasText: "doesn't allow it to be played outside YouTube" })).toBeVisible();
  });

  test("when the browser blocks autoplay, an obvious play button is offered", async ({ page }) => {
    await register(page, uniqueEmail());
    await page.addInitScript(() => ((window as unknown as { __ytBlockAutoplay: boolean }).__ytBlockAutoplay = true));
    await search(page, "jazz");
    await page.getByRole("button", { name: "Play Blue Jazz Evening" }).click();
    await expect(page.getByText("Your browser blocked autoplay. Press play to start.")).toBeVisible({ timeout: 8000 });
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.getByText("Your browser blocked autoplay")).toHaveCount(0);
  });

  test("YouTube script blocked or offline: friendly error instead of a crash", async ({ page, context }) => {
    await register(page, uniqueEmail());
    await context.unroute("https://www.youtube.com/iframe_api");
    await context.route("https://www.youtube.com/iframe_api", (r) => r.abort());
    await search(page, "jazz");
    await page.getByRole("button", { name: "Play Blue Jazz Evening" }).click();
    await expect(alertBox(page).filter({ hasText: "YouTube player couldn't load" })).toBeVisible();
  });
});

test.describe("settings", () => {
  test("the cloud connection test passes and leaves nothing behind", async ({ page }) => {
    const email = uniqueEmail();
    await register(page, email);
    await page.goto("/settings");
    await page.getByRole("button", { name: "Test cloud connection" }).click();
    await expect(page.getByText("Everything works. Saving to the cloud is possible.")).toBeVisible({ timeout: 20_000 });
    expect((await cloudLibrary(email))?.playlists ?? []).toHaveLength(0);
  });

  test("trash retention is validated and saved to the cloud", async ({ page }) => {
    const email = uniqueEmail();
    await register(page, email);
    await page.goto("/settings");
    const input = page.getByLabel("Keep deleted playlists for (days)");
    await input.fill("0");
    await expect(page.getByText("Enter a whole number from 1 to 365.")).toBeVisible();
    await input.fill("60");
    await page.getByRole("button", { name: "Save", exact: true }).first().click();
    await expect(page.getByText("Settings saved")).toBeVisible();
    await page.reload();
    await expect(input).toHaveValue("60");
  });

  test("adding a password to the account lets email sign-in open the same library", async ({ page, browser }) => {
    const email = uniqueEmail();
    await register(page, email);
    await page.goto("/settings");
    await page.getByLabel("Change password").fill("a-brand-new-password");
    await page.getByRole("button", { name: "Save", exact: true }).last().click();
    await expect(page.getByText("Password saved")).toBeVisible();
    const second = await newDevice(browser);
    await login(second.page, email, "a-brand-new-password");
    await second.context.close();
  });
});

test("keyboard users can reach the main content and the navigation", async ({ page }) => {
  await register(page, uniqueEmail());
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await expect(page.getByRole("navigation", { name: "Main" }).first()).toBeVisible();
});
