-- Run once after 008. Retains first-visitor owner creation for personal guides.
-- No business rows are removed. All state writes use member + device RPC checks.
begin;
revoke insert, update, delete on public.guide_execution_state, public.guide_checklist_state, public.guide_custom_checklist from public, anon, authenticated;
drop policy if exists "members manage execution" on public.guide_execution_state;
drop policy if exists "members manage checklist state" on public.guide_checklist_state;
drop policy if exists "members manage custom checklist" on public.guide_custom_checklist;
create policy "members read execution" on public.guide_execution_state for select to authenticated using (public.is_guide_member(guide_id));
create policy "members read checklist" on public.guide_checklist_state for select to authenticated using (public.is_guide_member(guide_id));
create policy "members read custom checklist" on public.guide_custom_checklist for select to authenticated using (public.is_guide_member(guide_id));
create or replace function public.bootstrap_guide_collab(p_guide_id text, p_edit_code text, p_device_token text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then raise exception 'sign-in required'; end if;
  if p_edit_code is null or p_edit_code !~ '^[0-9]{8}$' then raise exception 'edit code must be 8 digits'; end if;
  if p_guide_id is null or p_guide_id !~ '^[a-zA-Z0-9_-]{8,80}$' then raise exception 'invalid guide id'; end if;
  if p_edit_code is null or p_edit_code !~ '^[0-9]{8}$' then raise exception 'edit code must be 8 digits'; end if;
  insert into public.guide_collab_trips(guide_id,edit_code_hash)
  values (p_guide_id,extensions.crypt(p_edit_code,extensions.gen_salt('bf')));
  insert into public.guide_collab_members(guide_id,user_id,role) values (p_guide_id,auth.uid(),'owner');
  insert into public.guide_collab_device_sessions(guide_id,device_token,user_id) values (p_guide_id,p_device_token,auth.uid());
end; $$;

create or replace function public.join_guide_collab(p_guide_id text, p_edit_code text, p_device_token text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then raise exception 'sign-in required'; end if;
  if p_edit_code is null or p_edit_code !~ '^[0-9]{8}$' then raise exception 'edit code must be 8 digits'; end if;
  if p_guide_id is null or p_guide_id !~ '^[a-zA-Z0-9_-]{8,80}$' then raise exception 'invalid guide id'; end if;
  if not exists (select 1 from public.guide_collab_trips t where t.guide_id=p_guide_id and t.edit_code_hash=extensions.crypt(p_edit_code,t.edit_code_hash)) then raise exception 'invalid edit code'; end if;
  insert into public.guide_collab_members(guide_id,user_id,role) values (p_guide_id,auth.uid(),'editor') on conflict do nothing;
  insert into public.guide_collab_device_sessions(guide_id,device_token,user_id,last_seen_at) values (p_guide_id,p_device_token,auth.uid(),now()) on conflict (guide_id,device_token) do update set user_id=excluded.user_id,last_seen_at=now();
end; $$;

create or replace function public.restore_guide_collab(p_guide_id text, p_device_token text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return false; end if;
  if not public.is_guide_member(p_guide_id) then return false; end if;
  update public.guide_collab_device_sessions set last_seen_at=now() where guide_id=p_guide_id and device_token=p_device_token and user_id=auth.uid();
  return found;
end; $$;

create or replace function public.rotate_guide_edit_code(p_guide_id text, p_edit_code text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_edit_code is null or p_edit_code !~ '^[0-9]{8}$' then raise exception 'edit code must be 8 digits'; end if;
  if not exists (select 1 from public.guide_collab_members m where m.guide_id=p_guide_id and m.user_id=auth.uid() and m.role='owner') then raise exception 'owner required'; end if;
  update public.guide_collab_trips set edit_code_hash=extensions.crypt(p_edit_code,extensions.gen_salt('bf')) where guide_id=p_guide_id;
end; $$;

create or replace function public.save_guide_execution_state(
  p_guide_id text, p_entity_id text, p_entity_type text, p_booking_status text,
  p_note text, p_client_updated_at timestamptz, p_device_token text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'sign-in required'; end if;
  if not exists (select 1 from public.guide_collab_members where guide_id=p_guide_id and user_id=auth.uid()) then raise exception 'editor required'; end if;
  if not public.is_guide_member(p_guide_id) then raise exception 'editor required'; end if;
  if not exists (select 1 from public.guide_collab_device_sessions where guide_id=p_guide_id and device_token=p_device_token and user_id=auth.uid()) then raise exception 'device session invalid'; end if;
  insert into public.guide_execution_state(guide_id,entity_id,entity_type,booking_status,note,client_updated_at,updated_by_device,updated_at,updated_by)
  values(p_guide_id,p_entity_id,p_entity_type,p_booking_status,left(coalesce(p_note,''),800),clock_timestamp(),p_device_token,now(),auth.uid())
  on conflict (guide_id,entity_id) do update set entity_type=excluded.entity_type,booking_status=excluded.booking_status,note=excluded.note,client_updated_at=excluded.client_updated_at,updated_by_device=excluded.updated_by_device,updated_at=now(),updated_by=auth.uid()
  returning jsonb_build_object('entity_id',guide_execution_state.entity_id,'booking_status',guide_execution_state.booking_status,'note',guide_execution_state.note,'client_updated_at',guide_execution_state.client_updated_at) into result;
  return result;
end; $$;

create or replace function public.save_guide_checklist_state(
  p_guide_id text, p_item_id text, p_checked boolean, p_client_updated_at timestamptz, p_device_token text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'sign-in required'; end if;
  if not public.is_guide_member(p_guide_id) then raise exception 'editor required'; end if;
  if not exists (select 1 from public.guide_collab_device_sessions where guide_id=p_guide_id and device_token=p_device_token and user_id=auth.uid()) then raise exception 'device session invalid'; end if;
  insert into public.guide_checklist_state(guide_id,item_id,checked,client_updated_at,updated_by_device,updated_at,updated_by)
  values(p_guide_id,p_item_id,coalesce(p_checked,false),clock_timestamp(),p_device_token,now(),auth.uid())
  on conflict (guide_id,item_id) do update set checked=excluded.checked,client_updated_at=excluded.client_updated_at,updated_by_device=excluded.updated_by_device,updated_at=now(),updated_by=auth.uid()
  returning jsonb_build_object('item_id',guide_checklist_state.item_id,'checked',guide_checklist_state.checked,'client_updated_at',guide_checklist_state.client_updated_at) into result;
  return result;
end; $$;

create or replace function public.save_guide_custom_checklist(
  p_guide_id text, p_item_id text, p_text text, p_checked boolean, p_deleted boolean, p_client_updated_at timestamptz, p_device_token text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'sign-in required'; end if;
  if not public.is_guide_member(p_guide_id) then raise exception 'editor required'; end if;
  if not exists (select 1 from public.guide_collab_device_sessions where guide_id=p_guide_id and device_token=p_device_token and user_id=auth.uid()) then raise exception 'device session invalid'; end if;
  insert into public.guide_custom_checklist(guide_id,item_id,text,checked,deleted,client_updated_at,updated_by_device,updated_at,updated_by)
  values(p_guide_id,p_item_id,left(coalesce(p_text,''),240),coalesce(p_checked,false),coalesce(p_deleted,false),clock_timestamp(),p_device_token,now(),auth.uid())
  on conflict (guide_id,item_id) do update set text=excluded.text,checked=excluded.checked,deleted=excluded.deleted,client_updated_at=excluded.client_updated_at,updated_by_device=excluded.updated_by_device,updated_at=now(),updated_by=auth.uid()
  returning jsonb_build_object('item_id',guide_custom_checklist.item_id,'text',guide_custom_checklist.text,'checked',guide_custom_checklist.checked,'deleted',guide_custom_checklist.deleted,'client_updated_at',guide_custom_checklist.client_updated_at) into result;
  return result;
end; $$;

revoke all on function public.save_guide_execution_state(text,text,text,text,text,timestamptz,text), public.save_guide_checklist_state(text,text,boolean,timestamptz,text), public.save_guide_custom_checklist(text,text,text,boolean,boolean,timestamptz,text) from public,anon;
grant execute on function public.save_guide_execution_state(text,text,text,text,text,timestamptz,text), public.save_guide_checklist_state(text,text,boolean,timestamptz,text), public.save_guide_custom_checklist(text,text,text,boolean,boolean,timestamptz,text) to authenticated;

commit;
