-- Existing-project cleanup: remove obsolete two-argument collaboration RPCs and
-- collapse the duplicate checklist unique constraint created by 001 + 002.
-- Run once after 007_custom_checklist_text_limit.sql.
begin;

drop function if exists public.bootstrap_guide_collab(text,text);
drop function if exists public.join_guide_collab(text,text);

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'guide_custom_checklist_guide_id_item_id_key'
      and conrelid = 'public.guide_custom_checklist'::regclass
  ) and exists (
    select 1 from pg_constraint
    where conname = 'guide_custom_checklist_guide_item_key'
      and conrelid = 'public.guide_custom_checklist'::regclass
  ) then
    alter table public.guide_custom_checklist
      drop constraint guide_custom_checklist_guide_item_key;
  end if;
end $$;

commit;
