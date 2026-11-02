-- Existing-project migration: align custom checklist schema with the browser collaboration client.
-- Run once after 001_shared_execution_state.sql if the original table already exists.
alter table public.guide_custom_checklist add column if not exists item_id text;
update public.guide_custom_checklist set item_id = id::text where item_id is null;
alter table public.guide_custom_checklist alter column item_id set not null;
alter table public.guide_custom_checklist add column if not exists deleted boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'guide_custom_checklist_guide_item_key'
      and conrelid = 'public.guide_custom_checklist'::regclass
  ) then
    alter table public.guide_custom_checklist
      add constraint guide_custom_checklist_guide_item_key unique (guide_id, item_id);
  end if;
end $$;
