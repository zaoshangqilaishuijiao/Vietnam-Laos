-- Backward-compatible patch for projects that ran an older 004 definition before the 240-character fix.
-- Fresh installs already contain the same definition, so reapplying this migration is intentionally idempotent.
create or replace function public.save_guide_custom_checklist(
  p_guide_id text, p_item_id text, p_text text, p_checked boolean, p_deleted boolean, p_client_updated_at timestamptz, p_device_token text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'sign-in required'; end if;
  if not exists (select 1 from public.guide_collab_device_sessions where guide_id=p_guide_id and device_token=p_device_token and user_id=auth.uid()) then raise exception 'device session invalid'; end if;
  insert into public.guide_custom_checklist(guide_id,item_id,text,checked,deleted,client_updated_at,updated_by_device,updated_at,updated_by)
  values(p_guide_id,p_item_id,left(coalesce(p_text,''),240),coalesce(p_checked,false),coalesce(p_deleted,false),clock_timestamp(),p_device_token,now(),auth.uid())
  on conflict (guide_id,item_id) do update set text=excluded.text,checked=excluded.checked,deleted=excluded.deleted,client_updated_at=excluded.client_updated_at,updated_by_device=excluded.updated_by_device,updated_at=now(),updated_by=auth.uid()
  returning jsonb_build_object('item_id',guide_custom_checklist.item_id,'text',guide_custom_checklist.text,'checked',guide_custom_checklist.checked,'deleted',guide_custom_checklist.deleted,'client_updated_at',guide_custom_checklist.client_updated_at) into result;
  return result;
end; $$;

revoke all on function public.save_guide_custom_checklist(text,text,text,boolean,boolean,timestamptz,text) from public,anon;
grant execute on function public.save_guide_custom_checklist(text,text,text,boolean,boolean,timestamptz,text) to authenticated;
