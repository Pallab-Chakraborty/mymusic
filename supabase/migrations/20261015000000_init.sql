-- MyMusic initial schema
-- Run once on a new Supabase project (see README, "Set up the database").
--
-- Design rules:
--   * Every user-owned table has Row Level Security (RLS) enabled.
--   * A user can only ever see or change rows where user_id = their own id.
--   * Playlists are soft-deleted first (deleted_at). A playlist can only be
--     permanently deleted AFTER it is in the trash.
--   * Track order is stored explicitly in "position".

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) <= 100),
  created_at timestamptz not null default now()
);

create table public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  trash_retention_days integer not null default 30
    check (trash_retention_days between 1 and 365),
  shuffle boolean not null default false,
  repeat_mode text not null default 'off'
    check (repeat_mode in ('off', 'all', 'one')),
  updated_at timestamptz not null default now()
);

create table public.playlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  description text check (description is null or char_length(description) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- lets playlist_tracks prove it belongs to the same user as its playlist
  constraint playlists_id_user_unique unique (id, user_id)
);

create index playlists_user_active_idx
  on public.playlists (user_id, updated_at desc)
  where deleted_at is null;

create index playlists_user_trash_idx
  on public.playlists (user_id, deleted_at)
  where deleted_at is not null;

create table public.playlist_tracks (
  id uuid primary key default gen_random_uuid(),
  playlist_id uuid not null,
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  video_id text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  title text not null check (char_length(title) between 1 and 500),
  channel_title text not null default '' check (char_length(channel_title) <= 300),
  thumbnail_url text check (thumbnail_url is null or thumbnail_url ~ '^https://'),
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  position integer not null check (position >= 0),
  added_at timestamptz not null default now(),
  -- a track row can only point at a playlist owned by the same user
  constraint playlist_tracks_playlist_fk
    foreign key (playlist_id, user_id)
    references public.playlists (id, user_id) on delete cascade,
  -- duplicate protection: one entry per song per playlist
  constraint playlist_tracks_unique_video unique (playlist_id, video_id),
  -- explicit ordering; checked at commit so reordering can swap positions
  constraint playlist_tracks_unique_position unique (playlist_id, position)
    deferrable initially deferred
);

create index playlist_tracks_user_idx on public.playlist_tracks (user_id);

create table public.recently_played (
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  video_id text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  title text not null check (char_length(title) between 1 and 500),
  channel_title text not null default '' check (char_length(channel_title) <= 300),
  thumbnail_url text check (thumbnail_url is null or thumbnail_url ~ '^https://'),
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  played_at timestamptz not null default now(),
  primary key (user_id, video_id)
);

create index recently_played_user_time_idx
  on public.recently_played (user_id, played_at desc);

-- ---------------------------------------------------------------------------
-- Housekeeping triggers
-- ---------------------------------------------------------------------------

create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger playlists_touch_updated_at
  before update on public.playlists
  for each row execute function public.touch_updated_at();

create trigger user_settings_touch_updated_at
  before update on public.user_settings
  for each row execute function public.touch_updated_at();

-- Create a profile and default settings whenever someone signs up.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  insert into public.user_settings (user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.playlists enable row level security;
alter table public.playlist_tracks enable row level security;
alter table public.recently_played enable row level security;

-- Table privileges: signed-out visitors (anon) get nothing.
revoke all on public.profiles, public.user_settings, public.playlists,
  public.playlist_tracks, public.recently_played from anon;
revoke all on public.profiles, public.user_settings, public.playlists,
  public.playlist_tracks, public.recently_played from authenticated;

grant select, update on public.profiles to authenticated;
grant select, insert, update on public.user_settings to authenticated;
grant select, insert, update, delete on public.playlists to authenticated;
grant select, insert, update, delete on public.playlist_tracks to authenticated;
grant select, insert, update, delete on public.recently_played to authenticated;

-- profiles
create policy "profiles: read own" on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id);
create policy "profiles: update own" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- user_settings
create policy "settings: read own" on public.user_settings
  for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "settings: insert own" on public.user_settings
  for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "settings: update own" on public.user_settings
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- playlists
create policy "playlists: read own" on public.playlists
  for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "playlists: insert own" on public.playlists
  for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "playlists: update own" on public.playlists
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
-- Permanent deletion is only allowed for playlists already in the trash.
create policy "playlists: delete own trashed" on public.playlists
  for delete to authenticated
  using ((select auth.uid()) = user_id and deleted_at is not null);

-- playlist_tracks
create policy "tracks: read own" on public.playlist_tracks
  for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "tracks: insert own" on public.playlist_tracks
  for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "tracks: update own" on public.playlist_tracks
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "tracks: delete own" on public.playlist_tracks
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- recently_played
create policy "recent: read own" on public.recently_played
  for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "recent: insert own" on public.recently_played
  for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "recent: update own" on public.recently_played
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "recent: delete own" on public.recently_played
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Functions the app calls (all SECURITY INVOKER: RLS still applies to them)
-- ---------------------------------------------------------------------------

-- Re-number positions 0..n-1 without changing order.
create function public.normalize_track_positions(p_playlist_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.playlist_tracks pt
     set position = ranked.new_pos
    from (
      select id, (row_number() over (order by position) - 1)::integer as new_pos
        from public.playlist_tracks
       where playlist_id = p_playlist_id
    ) ranked
   where pt.id = ranked.id
     and pt.position is distinct from ranked.new_pos;
$$;

-- Create a playlist with a client-chosen id. Safe to call twice (idempotent),
-- which lets the app retry after a network failure without duplicating.
create function public.create_playlist(p_id uuid, p_name text)
returns public.playlists
language plpgsql
security invoker
set search_path = ''
as $$
declare
  result public.playlists;
begin
  insert into public.playlists (id, name)
  values (p_id, btrim(p_name))
  on conflict (id) do nothing;

  select * into result from public.playlists where id = p_id;
  if not found then
    raise exception 'playlist_not_found' using errcode = 'P0002';
  end if;
  return result;
end;
$$;

-- Append a song to the end of a playlist. Returns false if it was already there.
create function public.add_track_to_playlist(
  p_playlist_id uuid,
  p_video_id text,
  p_title text,
  p_channel_title text,
  p_thumbnail_url text,
  p_duration_seconds integer
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  next_pos integer;
  inserted integer;
begin
  perform 1 from public.playlists
   where id = p_playlist_id and deleted_at is null
   for update;
  if not found then
    raise exception 'playlist_not_found' using errcode = 'P0002';
  end if;

  select coalesce(max(position) + 1, 0) into next_pos
    from public.playlist_tracks where playlist_id = p_playlist_id;

  insert into public.playlist_tracks
    (playlist_id, video_id, title, channel_title, thumbnail_url, duration_seconds, position)
  values
    (p_playlist_id, p_video_id, p_title, coalesce(p_channel_title, ''),
     p_thumbnail_url, p_duration_seconds, next_pos)
  on conflict (playlist_id, video_id) do nothing;

  get diagnostics inserted = row_count;
  if inserted > 0 then
    update public.playlists set updated_at = now() where id = p_playlist_id;
  end if;
  return inserted > 0;
end;
$$;

create function public.remove_track_from_playlist(p_playlist_id uuid, p_video_id text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform 1 from public.playlists
   where id = p_playlist_id and deleted_at is null
   for update;
  if not found then
    raise exception 'playlist_not_found' using errcode = 'P0002';
  end if;

  delete from public.playlist_tracks
   where playlist_id = p_playlist_id and video_id = p_video_id;

  perform public.normalize_track_positions(p_playlist_id);
  update public.playlists set updated_at = now() where id = p_playlist_id;
end;
$$;

-- Put the listed songs in the given order. Songs that exist in the playlist
-- but are NOT in the list (for example, added from another device a moment
-- ago) are kept and placed after the listed ones. Nothing is ever deleted.
create function public.reorder_playlist_tracks(p_playlist_id uuid, p_video_ids text[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform 1 from public.playlists
   where id = p_playlist_id and deleted_at is null
   for update;
  if not found then
    raise exception 'playlist_not_found' using errcode = 'P0002';
  end if;

  with requested as (
    select vid, min(ord) as ord
      from unnest(p_video_ids) with ordinality as t (vid, ord)
     group by vid
  ),
  ranked as (
    select pt.id,
           (row_number() over (order by (r.ord is null), r.ord, pt.position) - 1)::integer as new_pos
      from public.playlist_tracks pt
      left join requested r on r.vid = pt.video_id
     where pt.playlist_id = p_playlist_id
  )
  update public.playlist_tracks pt
     set position = ranked.new_pos
    from ranked
   where pt.id = ranked.id;

  update public.playlists set updated_at = now() where id = p_playlist_id;
end;
$$;

-- Copy a playlist (and its tracks, in order) to a new playlist.
create function public.duplicate_playlist(p_source_id uuid, p_new_id uuid, p_new_name text)
returns public.playlists
language plpgsql
security invoker
set search_path = ''
as $$
declare
  result public.playlists;
begin
  perform 1 from public.playlists where id = p_source_id and deleted_at is null;
  if not found then
    raise exception 'playlist_not_found' using errcode = 'P0002';
  end if;

  insert into public.playlists (id, name, description)
  select p_new_id, btrim(p_new_name), description
    from public.playlists where id = p_source_id
  on conflict (id) do nothing;

  insert into public.playlist_tracks
    (playlist_id, video_id, title, channel_title, thumbnail_url, duration_seconds, position)
  select p_new_id, video_id, title, channel_title, thumbnail_url, duration_seconds, position
    from public.playlist_tracks
   where playlist_id = p_source_id
  on conflict (playlist_id, video_id) do nothing;

  select * into result from public.playlists where id = p_new_id;
  if not found then
    raise exception 'playlist_not_found' using errcode = 'P0002';
  end if;
  return result;
end;
$$;

-- Import a whole playlist in one all-or-nothing step.
-- p_tracks is a JSON array of objects with video_id, title, channel_title,
-- thumbnail_url, duration_seconds. Repeated songs are ignored.
create function public.import_playlist(
  p_id uuid,
  p_name text,
  p_description text,
  p_tracks jsonb
)
returns public.playlists
language plpgsql
security invoker
set search_path = ''
as $$
declare
  result public.playlists;
begin
  if jsonb_typeof(p_tracks) <> 'array' or jsonb_array_length(p_tracks) > 5000 then
    raise exception 'invalid_tracks' using errcode = '22023';
  end if;

  insert into public.playlists (id, name, description)
  values (p_id, btrim(p_name), p_description)
  on conflict (id) do nothing;

  select * into result from public.playlists where id = p_id;
  if not found then
    raise exception 'playlist_not_found' using errcode = 'P0002';
  end if;

  insert into public.playlist_tracks
    (playlist_id, video_id, title, channel_title, thumbnail_url, duration_seconds, position)
  select p_id,
         d.video_id,
         d.title,
         d.channel_title,
         d.thumbnail_url,
         d.duration_seconds,
         (row_number() over (order by d.ord) - 1)::integer
           + coalesce((select max(position) + 1 from public.playlist_tracks where playlist_id = p_id), 0)
    from (
      select distinct on (e.elem ->> 'video_id')
             e.elem ->> 'video_id' as video_id,
             e.elem ->> 'title' as title,
             coalesce(e.elem ->> 'channel_title', '') as channel_title,
             nullif(e.elem ->> 'thumbnail_url', '') as thumbnail_url,
             (e.elem ->> 'duration_seconds')::integer as duration_seconds,
             e.ord
        from jsonb_array_elements(p_tracks) with ordinality as e (elem, ord)
       order by e.elem ->> 'video_id', e.ord
    ) d
  on conflict (playlist_id, video_id) do nothing;

  perform public.normalize_track_positions(p_id);
  return result;
end;
$$;

-- Remember that a song was played (keeps the latest 100 per user).
create function public.record_play(
  p_video_id text,
  p_title text,
  p_channel_title text,
  p_thumbnail_url text,
  p_duration_seconds integer
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.recently_played
    (video_id, title, channel_title, thumbnail_url, duration_seconds, played_at)
  values
    (p_video_id, p_title, coalesce(p_channel_title, ''), p_thumbnail_url, p_duration_seconds, now())
  on conflict (user_id, video_id) do update
    set title = excluded.title,
        channel_title = excluded.channel_title,
        thumbnail_url = excluded.thumbnail_url,
        duration_seconds = excluded.duration_seconds,
        played_at = now();

  delete from public.recently_played
   where user_id = (select auth.uid())
     and video_id in (
       select video_id from public.recently_played
        where user_id = (select auth.uid())
        order by played_at desc
       offset 100
     );
end;
$$;

-- Permanently remove playlists that have been in the trash longer than the
-- user's retention setting (default 30 days). Only touches the caller's rows.
create function public.purge_expired_playlists()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  days integer;
  removed integer;
begin
  select trash_retention_days into days
    from public.user_settings where user_id = (select auth.uid());
  days := coalesce(days, 30);

  delete from public.playlists
   where user_id = (select auth.uid())
     and deleted_at is not null
     and deleted_at < now() - make_interval(days => days);

  get diagnostics removed = row_count;
  return removed;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges: signed-in users only
-- ---------------------------------------------------------------------------

revoke execute on function
  public.normalize_track_positions(uuid),
  public.create_playlist(uuid, text),
  public.add_track_to_playlist(uuid, text, text, text, text, integer),
  public.remove_track_from_playlist(uuid, text),
  public.reorder_playlist_tracks(uuid, text[]),
  public.duplicate_playlist(uuid, uuid, text),
  public.import_playlist(uuid, text, text, jsonb),
  public.record_play(text, text, text, text, integer),
  public.purge_expired_playlists()
from public, anon;

grant execute on function
  public.normalize_track_positions(uuid),
  public.create_playlist(uuid, text),
  public.add_track_to_playlist(uuid, text, text, text, text, integer),
  public.remove_track_from_playlist(uuid, text),
  public.reorder_playlist_tracks(uuid, text[]),
  public.duplicate_playlist(uuid, uuid, text),
  public.import_playlist(uuid, text, text, jsonb),
  public.record_play(text, text, text, text, integer),
  public.purge_expired_playlists()
to authenticated;

-- The signup trigger function must never be callable directly.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
