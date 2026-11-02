-- Travel Guide Builder v2: shared execution state (run once in Supabase SQL Editor)
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.guide_collab_trips (
  guide_id text primary key check (guide_id ~ '^[a-zA-Z0-9_-]{6,80}$'),
  edit_code_hash text not null,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid()
);
create table if not exists public.guide_collab_members (
  guide_id text not null references public.guide_collab_trips(guide_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','editor')),
  joined_at timestamptz not null default now(),
  primary key (guide_id,user_id)
);
create table if not exists public.guide_execution_state (
  guide_id text not null references public.guide_collab_trips(guide_id) on delete cascade,
  entity_id text not null,
  entity_type text not null check (entity_type in ('activity','meal','stay','transport')),
  booking_status text not null check (booking_status in ('confirmed','to_book','candidate','verify','cancelled')),
  note text not null default '' check (char_length(note) <= 800),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid(),
  primary key (guide_id,entity_id)
);
create table if not exists public.guide_checklist_state (
  guide_id text not null references public.guide_collab_trips(guide_id) on delete cascade,
  item_id text not null,
  checked boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid(),
  primary key (guide_id,item_id)
);
create table if not exists public.guide_custom_checklist (
  id uuid primary key default gen_random_uuid(),
  guide_id text not null references public.guide_collab_trips(guide_id) on delete cascade,
  item_id text not null,
  text text not null check (char_length(trim(text)) between 1 and 240),
  checked boolean not null default false,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_by uuid not null default auth.uid(),
  unique (guide_id, item_id)
);

create or replace function public.is_guide_member(p_guide_id text)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from public.guide_collab_members m where m.guide_id=p_guide_id and m.user_id=auth.uid());
$$;

create or replace function public.bootstrap_guide_collab(p_guide_id text, p_edit_code text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then raise exception 'sign-in required'; end if;
  if p_edit_code !~ '^\d{8}$' then raise exception 'edit code must be 8 digits'; end if;
  insert into public.guide_collab_trips(guide_id,edit_code_hash) values (p_guide_id,extensions.crypt(p_edit_code,extensions.gen_salt('bf')));
  insert into public.guide_collab_members(guide_id,user_id,role) values (p_guide_id,auth.uid(),'owner');
end; $$;

create or replace function public.join_guide_collab(p_guide_id text, p_edit_code text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then raise exception 'sign-in required'; end if;
  if not exists (select 1 from public.guide_collab_trips t where t.guide_id=p_guide_id and t.edit_code_hash=extensions.crypt(p_edit_code,t.edit_code_hash)) then raise exception 'invalid edit code'; end if;
  insert into public.guide_collab_members(guide_id,user_id,role) values (p_guide_id,auth.uid(),'editor') on conflict (guide_id,user_id) do nothing;
end; $$;

create or replace function public.rotate_guide_edit_code(p_guide_id text, p_edit_code text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_edit_code !~ '^\d{8}$' then raise exception 'edit code must be 8 digits'; end if;
  if not exists (select 1 from public.guide_collab_members m where m.guide_id=p_guide_id and m.user_id=auth.uid() and m.role='owner') then raise exception 'owner required'; end if;
  update public.guide_collab_trips set edit_code_hash=extensions.crypt(p_edit_code,extensions.gen_salt('bf')) where guide_id=p_guide_id;
end; $$;

alter table public.guide_collab_trips enable row level security;
alter table public.guide_collab_members enable row level security;
alter table public.guide_execution_state enable row level security;
alter table public.guide_checklist_state enable row level security;
alter table public.guide_custom_checklist enable row level security;
revoke all on table public.guide_collab_trips, public.guide_collab_members, public.guide_execution_state, public.guide_checklist_state, public.guide_custom_checklist from anon;
grant select,insert,update,delete on public.guide_execution_state,public.guide_checklist_state,public.guide_custom_checklist to authenticated;
grant select on public.guide_collab_trips,public.guide_collab_members to authenticated;
revoke all on function public.bootstrap_guide_collab(text,text),public.join_guide_collab(text,text),public.rotate_guide_edit_code(text,text) from public, anon;
grant execute on function public.bootstrap_guide_collab(text,text),public.join_guide_collab(text,text),public.rotate_guide_edit_code(text,text) to authenticated;

drop policy if exists "members read trips" on public.guide_collab_trips;
drop policy if exists "members read members" on public.guide_collab_members;
drop policy if exists "members manage execution" on public.guide_execution_state;
drop policy if exists "members manage checklist state" on public.guide_checklist_state;
drop policy if exists "members manage custom checklist" on public.guide_custom_checklist;
create policy "members read trips" on public.guide_collab_trips for select to authenticated using (public.is_guide_member(guide_id));
create policy "members read members" on public.guide_collab_members for select to authenticated using (public.is_guide_member(guide_id));
create policy "members manage execution" on public.guide_execution_state for all to authenticated using (public.is_guide_member(guide_id)) with check (public.is_guide_member(guide_id));
create policy "members manage checklist state" on public.guide_checklist_state for all to authenticated using (public.is_guide_member(guide_id)) with check (public.is_guide_member(guide_id));
create policy "members manage custom checklist" on public.guide_custom_checklist for all to authenticated using (public.is_guide_member(guide_id)) with check (public.is_guide_member(guide_id));

-- After running: enable these tables in Database > Replication > supabase_realtime:
-- guide_execution_state, guide_checklist_state, guide_custom_checklist
