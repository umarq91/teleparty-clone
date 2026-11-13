-- Mini Teleparty — room access control.
--
-- Model
--   * Clients sign in with Supabase *anonymous* auth (no accounts, no email).
--   * A room is created with a client-generated random secret; only its SHA-256 hash is stored.
--   * The invite token is "<room_id>.<secret>". Possession of the secret is the join credential.
--   * Rooms are capped at 2 members. All writes go through SECURITY DEFINER RPCs.
--   * Realtime *private* channels are authorised by an RLS policy on realtime.messages
--     that only lets members of room X use topic "room:X" (broadcast + presence).
--
-- Requires: Authentication -> Providers -> "Allow anonymous sign-ins" enabled.

create table if not exists public.rooms (
  id             uuid primary key default gen_random_uuid(),   -- 122 bits of randomness
  secret_hash    bytea       not null,
  created_by     uuid        not null,
  created_at     timestamptz not null default now(),
  last_active_at timestamptz not null default now()
);

create table if not exists public.room_members (
  room_id      uuid        not null references public.rooms(id) on delete cascade,
  user_id      uuid        not null,
  role         text        not null check (role in ('host', 'guest')),
  display_name text        not null default 'Guest' check (char_length(display_name) between 1 and 40),
  joined_at    timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index if not exists room_members_user_idx on public.room_members (user_id);

alter table public.rooms        enable row level security;
alter table public.room_members enable row level security;

-- Clients can only *read their own membership rows*. No direct writes at all.
drop policy if exists "read own membership" on public.room_members;
create policy "read own membership" on public.room_members
  for select to authenticated using (user_id = (select auth.uid()));

revoke all on public.rooms        from anon, authenticated;
revoke all on public.room_members from anon, authenticated;
grant select on public.room_members to authenticated;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Create a room and join it as host. A user can only be in one room at a time.
create or replace function public.create_room(p_secret text, p_display_name text default 'Host')
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_room uuid;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_secret is null or char_length(p_secret) < 22 or char_length(p_secret) > 128 then
    raise exception 'invalid_secret' using errcode = '22023';
  end if;

  perform public._leave_all(v_uid);

  insert into public.rooms (secret_hash, created_by)
  values (sha256(convert_to(p_secret, 'utf8')), v_uid)
  returning id into v_room;

  insert into public.room_members (room_id, user_id, role, display_name)
  values (v_room, v_uid, 'host', left(coalesce(nullif(trim(p_display_name), ''), 'Host'), 40));

  return v_room;
end $$;

-- Join (or re-join) a room with its secret. Returns {room_id, role}.
create or replace function public.join_room(p_room_id uuid, p_secret text, p_display_name text default 'Guest')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_room  public.rooms;
  v_role  text;
  v_name  text := left(coalesce(nullif(trim(p_display_name), ''), 'Guest'), 40);
  v_count int;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select * into v_room from public.rooms where id = p_room_id;
  -- Same error for "no such room" and "wrong secret": don't leak which rooms exist.
  if not found or v_room.secret_hash is distinct from sha256(convert_to(coalesce(p_secret, ''), 'utf8')) then
    raise exception 'room_not_found' using errcode = 'P0002';
  end if;

  -- Re-join by the same user: refresh and return existing role.
  update public.room_members
     set last_seen_at = now(), display_name = v_name
   where room_id = p_room_id and user_id = v_uid
   returning role into v_role;
  if found then
    update public.rooms set last_active_at = now() where id = p_room_id;
    return jsonb_build_object('room_id', p_room_id, 'role', v_role);
  end if;

  -- Free slots held by stale members (e.g. a browser profile that vanished).
  delete from public.room_members
   where room_id = p_room_id and last_seen_at < now() - interval '90 seconds';

  select count(*) into v_count from public.room_members where room_id = p_room_id;
  if v_count >= 2 then raise exception 'room_full' using errcode = 'P0001'; end if;

  v_role := case when exists (select 1 from public.room_members where room_id = p_room_id and role = 'host')
                 then 'guest' else 'host' end;

  -- One room per user at a time.
  perform public._leave_all(v_uid);

  insert into public.room_members (room_id, user_id, role, display_name)
  values (p_room_id, v_uid, v_role, v_name);
  update public.rooms set last_active_at = now() where id = p_room_id;

  return jsonb_build_object('room_id', p_room_id, 'role', v_role);
end $$;

-- Heartbeat. Returns false if the caller is no longer a member (kicked as stale / room deleted).
create or replace function public.touch_room(p_room_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  update public.room_members set last_seen_at = now()
   where room_id = p_room_id and user_id = v_uid;
  if not found then return false; end if;
  update public.rooms set last_active_at = now() where id = p_room_id;
  return true;
end $$;

create or replace function public.leave_room(p_room_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  delete from public.room_members where room_id = p_room_id and user_id = v_uid;
  delete from public.rooms r where r.id = p_room_id
    and not exists (select 1 from public.room_members m where m.room_id = r.id);
end $$;

-- Internal helper (not callable by clients).
create or replace function public._leave_all(p_uid uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.room_members where user_id = p_uid;
  delete from public.rooms r
   where not exists (select 1 from public.room_members m where m.room_id = r.id)
     and r.last_active_at < now() - interval '1 minute';
end $$;

-- Garbage collection of abandoned rooms/presence. Schedule with pg_cron (see README):
--   select cron.schedule('mtp-cleanup', '*/10 * * * *', 'select public.cleanup_stale_rooms()');
create or replace function public.cleanup_stale_rooms()
returns void
language sql security definer set search_path = ''
as $$
  delete from public.room_members where last_seen_at < now() - interval '10 minutes';
  delete from public.rooms r
   where not exists (select 1 from public.room_members m where m.room_id = r.id)
      or r.last_active_at < now() - interval '24 hours';
$$;

revoke all on function public.create_room(text, text)        from public, anon;
revoke all on function public.join_room(uuid, text, text)     from public, anon;
revoke all on function public.touch_room(uuid)                from public, anon;
revoke all on function public.leave_room(uuid)                from public, anon;
revoke all on function public._leave_all(uuid)                from public, anon, authenticated;
revoke all on function public.cleanup_stale_rooms()           from public, anon, authenticated;
grant execute on function public.create_room(text, text)      to authenticated;
grant execute on function public.join_room(uuid, text, text)  to authenticated;
grant execute on function public.touch_room(uuid)             to authenticated;
grant execute on function public.leave_room(uuid)             to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime authorization (private channels). Topic format: "room:<uuid>".
-- ---------------------------------------------------------------------------
drop policy if exists "room members can receive" on realtime.messages;
create policy "room members can receive" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and exists (
      select 1 from public.room_members m
      where m.user_id = (select auth.uid())
        and (select realtime.topic()) = 'room:' || m.room_id::text
    )
  );

drop policy if exists "room members can send" on realtime.messages;
create policy "room members can send" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and exists (
      select 1 from public.room_members m
      where m.user_id = (select auth.uid())
        and (select realtime.topic()) = 'room:' || m.room_id::text
    )
  );
