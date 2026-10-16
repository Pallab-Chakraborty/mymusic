import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asAnon, asUser, createDb, createUser, track, vid } from "./harness";

let db: PGlite;
let alice: string;
let bob: string;

const newId = async () => (await db.query<{ id: string }>("select gen_random_uuid() as id")).rows[0].id;

async function addTrack(userId: string, playlistId: string, n: number) {
  const t = track(n);
  return asUser(db, userId, async () => {
    const r = await db.query<{ add_track_to_playlist: boolean }>(
      "select public.add_track_to_playlist($1,$2,$3,$4,$5,$6)",
      [playlistId, t.video_id, t.title, t.channel_title, t.thumbnail_url, t.duration_seconds],
    );
    return r.rows[0].add_track_to_playlist;
  });
}

async function createPlaylist(userId: string, name: string) {
  const id = await newId();
  await asUser(db, userId, () => db.query("select * from public.create_playlist($1,$2)", [id, name]));
  return id;
}

async function order(userId: string, playlistId: string) {
  return asUser(db, userId, async () => {
    const r = await db.query<{ video_id: string; position: number }>(
      "select video_id, position from public.playlist_tracks where playlist_id=$1 order by position",
      [playlistId],
    );
    return r.rows;
  });
}

beforeAll(async () => {
  db = await createDb();
  alice = await createUser(db, "alice@example.com");
  bob = await createUser(db, "bob@example.com");
});

afterAll(async () => {
  await db.close();
});

describe("signup", () => {
  it("creates a profile and default settings for each new user", async () => {
    const profiles = await db.query("select id from public.profiles where id = $1", [alice]);
    const settings = await db.query(
      "select trash_retention_days, repeat_mode, shuffle from public.user_settings where user_id = $1",
      [alice],
    );
    expect(profiles.rows).toHaveLength(1);
    expect(settings.rows[0]).toEqual({ trash_retention_days: 30, repeat_mode: "off", shuffle: false });
  });
});

describe("user data isolation (Row Level Security)", () => {
  it("signed-out visitors cannot read or write anything", async () => {
    await expect(asAnon(db, () => db.query("select * from public.playlists"))).rejects.toThrow(/permission denied/i);
    await expect(asAnon(db, () => db.query("insert into public.playlists (name) values ('x')"))).rejects.toThrow(
      /permission denied/i,
    );
    await expect(asAnon(db, () => db.query("select * from public.playlist_tracks"))).rejects.toThrow(
      /permission denied/i,
    );
  });

  it("a user only sees their own playlists, tracks, history and settings", async () => {
    const aliceList = await createPlaylist(alice, "Alice mix");
    await addTrack(alice, aliceList, 1);
    await asUser(db, alice, () => db.query("select public.record_play($1,'t','c',null,100)", [vid(1)]));

    const seen = await asUser(db, bob, async () => ({
      playlists: (await db.query("select id from public.playlists")).rows,
      tracks: (await db.query("select id from public.playlist_tracks")).rows,
      recent: (await db.query("select video_id from public.recently_played")).rows,
      settings: (await db.query("select user_id from public.user_settings")).rows,
      profiles: (await db.query("select id from public.profiles")).rows,
    }));
    expect(seen.playlists).toHaveLength(0);
    expect(seen.tracks).toHaveLength(0);
    expect(seen.recent).toHaveLength(0);
    expect(seen.settings).toEqual([{ user_id: bob }]);
    expect(seen.profiles).toEqual([{ id: bob }]);
  });

  it("a user cannot modify, rename, soft-delete or delete another user's playlist", async () => {
    const aliceList = await createPlaylist(alice, "Private");
    const result = await asUser(db, bob, async () => {
      const upd = await db.query("update public.playlists set name='hacked' where id=$1", [aliceList]);
      const soft = await db.query("update public.playlists set deleted_at=now() where id=$1", [aliceList]);
      const del = await db.query("delete from public.playlists where id=$1", [aliceList]);
      return [upd.affectedRows, soft.affectedRows, del.affectedRows];
    });
    expect(result).toEqual([0, 0, 0]);
    const still = await db.query<{ name: string; deleted_at: string | null }>(
      "select name, deleted_at from public.playlists where id=$1",
      [aliceList],
    );
    expect(still.rows[0]).toEqual({ name: "Private", deleted_at: null });
  });

  it("a user cannot create rows that claim to belong to someone else", async () => {
    await expect(
      asUser(db, bob, () => db.query("insert into public.playlists (user_id, name) values ($1, 'forged')", [alice])),
    ).rejects.toThrow(/row-level security/i);
  });

  it("a user cannot hand their playlist to another user", async () => {
    const mine = await createPlaylist(bob, "Mine");
    await expect(
      asUser(db, bob, () => db.query("update public.playlists set user_id=$1 where id=$2", [alice, mine])),
    ).rejects.toThrow(/row-level security/i);
  });

  it("a user cannot add, remove or reorder tracks in another user's playlist", async () => {
    const aliceList = await createPlaylist(alice, "Alice only");
    await addTrack(alice, aliceList, 5);

    await expect(addTrack(bob, aliceList, 6)).rejects.toThrow(/playlist_not_found/);
    await expect(
      asUser(db, bob, () => db.query("select public.remove_track_from_playlist($1,$2)", [aliceList, vid(5)])),
    ).rejects.toThrow(/playlist_not_found/);
    await expect(
      asUser(db, bob, () => db.query("select public.reorder_playlist_tracks($1,$2)", [aliceList, [vid(5)]])),
    ).rejects.toThrow(/playlist_not_found/);
    await expect(
      asUser(db, bob, () =>
        db.query("select * from public.duplicate_playlist($1,gen_random_uuid(),'copy')", [aliceList]),
      ),
    ).rejects.toThrow(/playlist_not_found/);

    expect(await order(alice, aliceList)).toHaveLength(1);
  });

  it("direct inserts cannot attach a track to someone else's playlist", async () => {
    const aliceList = await createPlaylist(alice, "Alice again");
    await expect(
      asUser(db, bob, () =>
        db.query("insert into public.playlist_tracks (playlist_id, video_id, title, position) values ($1,$2,'x',0)", [
          aliceList,
          vid(9),
        ]),
      ),
    ).rejects.toThrow();
  });

  it("refuses to take over a playlist id that belongs to another user", async () => {
    const aliceList = await createPlaylist(alice, "Taken");
    await expect(
      asUser(db, bob, () => db.query("select * from public.create_playlist($1,'mine now')", [aliceList])),
    ).rejects.toThrow();
    const row = await db.query<{ user_id: string; name: string }>(
      "select user_id, name from public.playlists where id=$1",
      [aliceList],
    );
    expect(row.rows[0]).toEqual({ user_id: alice, name: "Taken" });
  });

  it("purging only affects the caller's own trash", async () => {
    const a = await createPlaylist(alice, "Alice old");
    const b = await createPlaylist(bob, "Bob old");
    await db.query("update public.playlists set deleted_at = now() - interval '400 days' where id = any($1)", [[a, b]]);
    const removed = await asUser(db, alice, async () => {
      const r = await db.query<{ purge_expired_playlists: number }>("select public.purge_expired_playlists()");
      return r.rows[0].purge_expired_playlists;
    });
    expect(removed).toBeGreaterThanOrEqual(1);
    const left = await db.query("select id from public.playlists where id = any($1)", [[a, b]]);
    expect(left.rows.map((r) => (r as { id: string }).id)).toEqual([b]);
  });
});

describe("playlist tracks: ordering and duplicates", () => {
  it("appends in order and refuses duplicates", async () => {
    const p = await createPlaylist(alice, "Order");
    expect(await addTrack(alice, p, 1)).toBe(true);
    expect(await addTrack(alice, p, 2)).toBe(true);
    expect(await addTrack(alice, p, 3)).toBe(true);
    expect(await addTrack(alice, p, 2)).toBe(false);
    const rows = await order(alice, p);
    expect(rows.map((r) => r.video_id)).toEqual([vid(1), vid(2), vid(3)]);
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2]);
  });

  it("removing a track closes the gap", async () => {
    const p = await createPlaylist(alice, "Remove");
    for (const n of [1, 2, 3, 4]) await addTrack(alice, p, n);
    await asUser(db, alice, () => db.query("select public.remove_track_from_playlist($1,$2)", [p, vid(2)]));
    const rows = await order(alice, p);
    expect(rows.map((r) => r.video_id)).toEqual([vid(1), vid(3), vid(4)]);
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2]);
  });

  it("reorders to exactly the requested order", async () => {
    const p = await createPlaylist(alice, "Reorder");
    for (const n of [1, 2, 3, 4]) await addTrack(alice, p, n);
    await asUser(db, alice, () =>
      db.query("select public.reorder_playlist_tracks($1,$2)", [p, [vid(4), vid(2), vid(1), vid(3)]]),
    );
    expect((await order(alice, p)).map((r) => r.video_id)).toEqual([vid(4), vid(2), vid(1), vid(3)]);
  });

  it("reorder never drops a song that was added elsewhere in the meantime", async () => {
    const p = await createPlaylist(alice, "Concurrent");
    for (const n of [1, 2, 3]) await addTrack(alice, p, n);
    // another device added song 4 after this device last synced
    await addTrack(alice, p, 4);
    await asUser(db, alice, () =>
      db.query("select public.reorder_playlist_tracks($1,$2)", [p, [vid(3), vid(2), vid(1)]]),
    );
    const rows = await order(alice, p);
    expect(rows.map((r) => r.video_id)).toEqual([vid(3), vid(2), vid(1), vid(4)]);
  });

  it("ignores unknown ids and repeated ids in a reorder request", async () => {
    const p = await createPlaylist(alice, "Messy reorder");
    for (const n of [1, 2]) await addTrack(alice, p, n);
    await asUser(db, alice, () =>
      db.query("select public.reorder_playlist_tracks($1,$2)", [p, [vid(2), vid(2), vid(77), vid(1)]]),
    );
    expect((await order(alice, p)).map((r) => r.video_id)).toEqual([vid(2), vid(1)]);
  });

  it("rejects malformed video ids at the database level", async () => {
    const p = await createPlaylist(alice, "Validation");
    await expect(
      asUser(db, alice, () => db.query("select public.add_track_to_playlist($1,'not valid!','t','c',null,1)", [p])),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      asUser(db, alice, () =>
        db.query("select public.add_track_to_playlist($1,$2,'t','c','http://insecure.example/x.jpg',1)", [p, vid(1)]),
      ),
    ).rejects.toThrow(/check constraint/i);
  });

  it("cannot add songs to a playlist that is in the trash", async () => {
    const p = await createPlaylist(alice, "Trashed add");
    await asUser(db, alice, () => db.query("update public.playlists set deleted_at=now() where id=$1", [p]));
    await expect(addTrack(alice, p, 1)).rejects.toThrow(/playlist_not_found/);
  });
});

describe("playlist lifecycle", () => {
  it("create_playlist is safe to retry (no duplicate on a repeated request)", async () => {
    const id = await newId();
    for (let i = 0; i < 3; i++) {
      await asUser(db, alice, () => db.query("select * from public.create_playlist($1,'Retry me')", [id]));
    }
    const rows = await db.query("select id from public.playlists where id=$1", [id]);
    expect(rows.rows).toHaveLength(1);
  });

  it("trims names and rejects empty or oversized names", async () => {
    const id = await newId();
    await asUser(db, alice, () => db.query("select * from public.create_playlist($1,'  Spaced  ')", [id]));
    const r = await db.query<{ name: string }>("select name from public.playlists where id=$1", [id]);
    expect(r.rows[0].name).toBe("Spaced");

    await expect(
      asUser(db, alice, async () => db.query("select * from public.create_playlist(gen_random_uuid(),'   ')")),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      asUser(db, alice, async () =>
        db.query("select * from public.create_playlist(gen_random_uuid(), $1)", ["x".repeat(101)]),
      ),
    ).rejects.toThrow(/check constraint/i);
  });

  it("duplicates a playlist with tracks in the same order, independently", async () => {
    const src = await createPlaylist(alice, "Original");
    for (const n of [3, 1, 2]) await addTrack(alice, src, n);
    const copy = await newId();
    await asUser(db, alice, () =>
      db.query("select * from public.duplicate_playlist($1,$2,'Original (copy)')", [src, copy]),
    );
    expect((await order(alice, copy)).map((r) => r.video_id)).toEqual([vid(3), vid(1), vid(2)]);

    await asUser(db, alice, () => db.query("select public.remove_track_from_playlist($1,$2)", [copy, vid(3)]));
    expect(await order(alice, src)).toHaveLength(3);
    expect(await order(alice, copy)).toHaveLength(2);
  });

  it("permanent delete is refused until the playlist is in the trash", async () => {
    const p = await createPlaylist(alice, "Protected");
    await addTrack(alice, p, 1);

    const direct = await asUser(db, alice, () => db.query("delete from public.playlists where id=$1", [p]));
    expect(direct.affectedRows).toBe(0);
    expect(await order(alice, p)).toHaveLength(1);

    await asUser(db, alice, () => db.query("update public.playlists set deleted_at=now() where id=$1", [p]));
    const afterSoft = await asUser(db, alice, () =>
      db.query("select id from public.playlists where id=$1 and deleted_at is not null", [p]),
    );
    expect(afterSoft.rows).toHaveLength(1);
  });

  it("restoring a trashed playlist brings back every track in order", async () => {
    const p = await createPlaylist(alice, "Restore me");
    for (const n of [1, 2, 3]) await addTrack(alice, p, n);

    await asUser(db, alice, () => db.query("update public.playlists set deleted_at=now() where id=$1", [p]));
    await asUser(db, alice, () => db.query("update public.playlists set deleted_at=null where id=$1", [p]));

    const row = await db.query<{ deleted_at: string | null }>("select deleted_at from public.playlists where id=$1", [
      p,
    ]);
    expect(row.rows[0].deleted_at).toBeNull();
    expect((await order(alice, p)).map((r) => r.video_id)).toEqual([vid(1), vid(2), vid(3)]);
  });

  it("permanently deleting a trashed playlist also removes its tracks", async () => {
    const p = await createPlaylist(alice, "Gone");
    await addTrack(alice, p, 1);
    await asUser(db, alice, () => db.query("update public.playlists set deleted_at=now() where id=$1", [p]));
    const del = await asUser(db, alice, () => db.query("delete from public.playlists where id=$1", [p]));
    expect(del.affectedRows).toBe(1);
    const left = await db.query("select 1 from public.playlist_tracks where playlist_id=$1", [p]);
    expect(left.rows).toHaveLength(0);
  });

  it("purge removes only playlists older than the retention setting", async () => {
    const carol = await createUser(db, "carol@example.com");
    await asUser(db, carol, () =>
      db.query("update public.user_settings set trash_retention_days = 7 where user_id = $1", [carol]),
    );
    const old = await createPlaylist(carol, "Old");
    const recent = await createPlaylist(carol, "Recent");
    const active = await createPlaylist(carol, "Active");
    await db.query("update public.playlists set deleted_at = now() - interval '8 days' where id=$1", [old]);
    await db.query("update public.playlists set deleted_at = now() - interval '2 days' where id=$1", [recent]);

    const removed = await asUser(db, carol, async () => {
      const r = await db.query<{ purge_expired_playlists: number }>("select public.purge_expired_playlists()");
      return r.rows[0].purge_expired_playlists;
    });
    expect(removed).toBe(1);
    const ids = (await db.query<{ id: string }>("select id from public.playlists where user_id=$1", [carol])).rows.map(
      (r) => r.id,
    );
    expect(ids.sort()).toEqual([recent, active].sort());
  });

  it("retention days must be between 1 and 365", async () => {
    await expect(
      asUser(db, alice, () =>
        db.query("update public.user_settings set trash_retention_days = 0 where user_id=$1", [alice]),
      ),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      asUser(db, alice, () =>
        db.query("update public.user_settings set trash_retention_days = 9999 where user_id=$1", [alice]),
      ),
    ).rejects.toThrow(/check constraint/i);
  });
});

describe("import", () => {
  it("imports in one step, keeps order, drops repeated songs", async () => {
    const id = await newId();
    const tracks = [track(1), track(2), track(1), track(3)];
    await asUser(db, alice, () =>
      db.query("select * from public.import_playlist($1,'Imported',null,$2::jsonb)", [id, JSON.stringify(tracks)]),
    );
    const rows = await order(alice, id);
    expect(rows.map((r) => r.video_id)).toEqual([vid(1), vid(2), vid(3)]);
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2]);
  });

  it("is all-or-nothing: one bad track leaves no half-imported playlist", async () => {
    const id = await newId();
    const bad = [track(1), { ...track(2), video_id: "bad id" }];
    await expect(
      asUser(db, alice, () =>
        db.query("select * from public.import_playlist($1,'Half',null,$2::jsonb)", [id, JSON.stringify(bad)]),
      ),
    ).rejects.toThrow();
    const left = await db.query("select 1 from public.playlists where id=$1", [id]);
    expect(left.rows).toHaveLength(0);
  });

  it("is safe to retry with the same id", async () => {
    const id = await newId();
    const payload = JSON.stringify([track(1), track(2)]);
    for (let i = 0; i < 2; i++) {
      await asUser(db, alice, () =>
        db.query("select * from public.import_playlist($1,'Twice',null,$2::jsonb)", [id, payload]),
      );
    }
    expect(await order(alice, id)).toHaveLength(2);
  });

  it("rejects payloads that are not arrays", async () => {
    await expect(
      asUser(db, alice, () => db.query("select * from public.import_playlist(gen_random_uuid(),'x',null,'{}'::jsonb)")),
    ).rejects.toThrow(/invalid_tracks/);
  });
});

describe("recently played", () => {
  it("keeps one row per song, newest first, and prunes beyond 100", async () => {
    const dave = await createUser(db, "dave@example.com");
    await asUser(db, dave, async () => {
      for (let n = 1; n <= 105; n++) {
        await db.query("select public.record_play($1,$2,'c',null,100)", [vid(n), `Song ${n}`]);
        // make earlier plays older than later ones (all in the past)
        await db.query(
          "update public.recently_played set played_at = now() - (($1::int) || ' seconds')::interval where video_id=$2",
          [200 - n, vid(n)],
        );
      }
      await db.query("select public.record_play($1,'Song 1 again','c',null,100)", [vid(1)]);
    });
    const rows = await asUser(
      db,
      dave,
      async () =>
        (
          await db.query<{ video_id: string; title: string }>(
            "select video_id, title from public.recently_played order by played_at desc",
          )
        ).rows,
    );
    expect(rows.length).toBeLessThanOrEqual(100);
    expect(rows[0]).toEqual({ video_id: vid(1), title: "Song 1 again" });
    expect(new Set(rows.map((r) => r.video_id)).size).toBe(rows.length);
  });
});
