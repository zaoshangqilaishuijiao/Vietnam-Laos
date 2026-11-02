-- Run once after 001_shared_execution_state.sql and 002_align_custom_checklist.sql.
-- Adds persistent device sessions, server-managed compatibility timestamps and explicit pgcrypto schema qualification.
create extension if not exists pgcrypto with schema extensions;

alter table public.guide_execution_state add column if not exists client_updated_at timestamptz not null default now();
alter table public.guide_execution_state add column if not exists updated_by_device text;
alter table public.guide_checklist_state add column if not exists client_updated_at timestamptz not null default now();
alter table public.guide_checklist_state add column if not exists updated_by_device text;
alter table public.guide_custom_checklist add column if not exists client_updated_at timestamptz not null default now();
alter table public.guide_custom_checklist add column if not exists updated_by_device text;

create table if not exists public.guide_collab_device_sessions (
  guide_id text not null references public.guide_collab_trips(guide_id) on delete cascade,
  device_token text not null check (device_token ~ '^[a-zA-Z0-9_-]{16,160}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (guide_id, device_token)
);
alter table public.guide_collab_device_sessions enable row level security;
revoke all on public.guide_collab_device_sessions from anon;

create or replace function public.bootstrap_guide_collab(p_guide_id text, p_edit_code text, p_device_token text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then raise exception 'sign-in required'; end if;
  if p_edit_code !~ '^\\d{8}$' then raise exception 'edit code must be 8 digits'; end if;
  insert into public.guide_collab_trips(guide_id,edit_code_hash)
  values (p_guide_id,extensions.crypt(p_edit_code,extensions.gen_salt('bf')));
  insert into public.guide_collab_members(guide_id,user_id,role) values (p_guide_id,auth.uid(),'owner');
  insert into public.guide_collab_device_sessions(guide_id,device_token,user_id) values (p_guide_id,p_device_token,auth.uid());
end; $$;

create or replace function public.join_guide_collab(p_guide_id text, p_edit_code text, p_device_token text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then raise exception 'sign-in required'; end if;
  if not exists (select 1 from public.guide_collab_trips t where t.guide_id=p_guide_id and t.edit_code_hash=extensions.crypt(p_edit_code,t.edit_code_hash)) then raise exception 'invalid edit code'; end if;
  insert into public.guide_collab_members(guide_id,user_id,role) values (p_guide_id,auth.uid(),'editor') on conflict do nothing;
  insert into public.guide_collab_device_sessions(guide_id,device_token,user_id,last_seen_at) values (p_guide_id,p_device_token,auth.uid(),now()) on conflict (guide_id,device_token) do update set user_id=excluded.user_id,last_seen_at=now();
end; $$;

create or replace function public.restore_guide_collab(p_guide_id text, p_device_token text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return false; end if;
  update public.guide_collab_device_sessions set last_seen_at=now() where guide_id=p_guide_id and device_token=p_device_token and user_id=auth.uid();
  return found;
end; $$;

create or replace function public.leave_guide_collab(p_guide_id text, p_device_token text)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.guide_collab_device_sessions where guide_id=p_guide_id and device_token=p_device_token and user_id=auth.uid();
end; $$;

revoke all on function public.bootstrap_guide_collab(text,text,text),public.join_guide_collab(text,text,text),public.restore_guide_collab(text,text),public.leave_guide_collab(text,text) from public,anon;
grant execute on function public.bootstrap_guide_collab(text,text,text),public.join_guide_collab(text,text,text),public.restore_guide_collab(text,text),public.leave_guide_collab(text,text) to authenticated;
