# Backup and restore

**Three different things:** _persistence_ (data is stored in Supabase), _backups_ (Supabase's own copies of the database; plan-dependent) and _exports_ (a file you keep). Free-tier hosting does **not** guarantee independent backups or zero data loss.

## 1. Your own export (do this regularly)

Settings → **Export all playlists (JSON)**. Store the file in cloud storage you control. Per-playlist **JSON** and **M3U** are on each playlist page. M3U keeps each YouTube link and a `#MYMUSIC:videoId=` line.

## 2. Restore from an export

Settings → **Import from a backup file**. Playlists are added as _new_ playlists (nothing is overwritten); delete duplicates afterwards.

## 3. Deleted a playlist by mistake?

Playlists → _Recently deleted_ → **Restore** (kept for the number of days set in Settings, default 30, then purged).

## 4. Supabase database backups

- Free plan: no promised backups. Pro plan and above: daily backups (Supabase → Database → Backups) and optional point-in-time recovery. Restore from that page.
- DIY full dump (needs the Supabase CLI and the database connection string from Supabase → Connect; keep that string private):
  `supabase db dump --db-url "<connection string>" -f backup.sql` and `… --data-only -f data.sql`.
- Restore a dump into a fresh project: run the migration first, then `psql "<new connection string>" -f data.sql`.

## 5. Rebuilding from nothing

New Supabase project → run `supabase/migrations/*.sql` → create account → import your JSON export.
