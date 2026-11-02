-- Run once after 004_lww_execution_save.sql.
-- Stores sanitized flight execution metadata only. Ticket images and image keys remain browser-local.
create table if not exists public.guide_flight_records (
  guide_id text not null references public.guide_collab_trips(guide_id) on delete cascade,
  record_id text not null check (record_id ~ '^[a-zA-Z0-9_-]{8,160}$'),
  flight_data jsonb not null default '{}'::jsonb,
  updated_by_device text,
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid(),
  primary key (guide_id, record_id)
);

alter table public.guide_flight_records add column if not exists flight_data jsonb not null default '{}'::jsonb;
-- 兼容早期按列保存的航班同步表：模板版以白名单 JSON 为唯一元数据载体。
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='guide_flight_records' and column_name='flight_number') then
    alter table public.guide_flight_records alter column flight_number drop not null;
    alter table public.guide_flight_records alter column airline drop not null;
    alter table public.guide_flight_records alter column departure_airport drop not null;
    alter table public.guide_flight_records alter column arrival_airport drop not null;
  end if;
end $$;
alter table public.guide_flight_records enable row level security;
revoke all on public.guide_flight_records from anon;
grant select, insert, update, delete on public.guide_flight_records to authenticated;
drop policy if exists "members manage flight records" on public.guide_flight_records;
create policy "members manage flight records" on public.guide_flight_records for all to authenticated using (public.is_guide_member(guide_id)) with check (public.is_guide_member(guide_id));

create or replace function public.replace_guide_flight_records(p_guide_id text, p_records jsonb, p_device_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare value jsonb; clean jsonb; count_records integer := 0;
begin
  if auth.uid() is null then raise exception 'sign-in required'; end if;
  if not exists (select 1 from public.guide_collab_members where guide_id=p_guide_id and user_id=auth.uid()) then raise exception 'editor required'; end if;
  if not exists (select 1 from public.guide_collab_device_sessions where guide_id=p_guide_id and device_token=p_device_token and user_id=auth.uid()) then raise exception 'device session invalid'; end if;
  if jsonb_typeof(p_records) <> 'array' or jsonb_array_length(p_records) > 16 then raise exception 'invalid flight record group'; end if;
  delete from public.guide_flight_records where guide_id=p_guide_id;
  for value in select * from jsonb_array_elements(p_records) loop
    if coalesce(value->>'id','') !~ '^[a-zA-Z0-9_-]{8,160}$' then raise exception 'invalid record id'; end if;
    if char_length(coalesce(value->>'flightNumber','')) not between 1 and 32 or char_length(coalesce(value->>'airline','')) not between 1 and 120 then raise exception 'invalid flight identity'; end if;
    if char_length(coalesce(value->>'departureAirport','')) not between 1 and 200 or char_length(coalesce(value->>'arrivalAirport','')) not between 1 and 200 then raise exception 'invalid airport'; end if;
    if coalesce(value->>'detailUrl','') <> '' and value->>'detailUrl' !~ '^https://' then raise exception 'invalid detail url'; end if;
    clean := jsonb_strip_nulls(jsonb_build_object(
      'id', left(value->>'id',160), 'legLabel', case when value->>'legLabel' in ('去程','返程') then value->>'legLabel' end,
      'flightNumber', left(value->>'flightNumber',32), 'airline', left(value->>'airline',120),
      'departureDate', nullif(value->>'departureDate',''), 'arrivalDate', nullif(value->>'arrivalDate',''),
      'departureTime', nullif(value->>'departureTime',''), 'arrivalTime', nullif(value->>'arrivalTime',''),
      'departureCode', left(coalesce(value->>'departureCode',''),3), 'departureAirport', left(value->>'departureAirport',200), 'departureTerminal', left(coalesce(value->>'departureTerminal',''),12),
      'arrivalCode', left(coalesce(value->>'arrivalCode',''),3), 'arrivalAirport', left(value->>'arrivalAirport',200), 'arrivalTerminal', left(coalesce(value->>'arrivalTerminal',''),12),
      'durationMinutes', case when (value->>'durationMinutes') ~ '^\d{1,4}$' then (value->>'durationMinutes')::integer end,
      'seat', left(coalesce(value->>'seat',''),12), 'gate', left(coalesce(value->>'gate',''),12), 'baggageClaim', left(coalesce(value->>'baggageClaim',''),12),
      'connection', case when jsonb_typeof(value->'connection')='object' then jsonb_strip_nulls(jsonb_build_object('airportCode',left(coalesce(value->'connection'->>'airportCode',''),3),'airport',left(coalesce(value->'connection'->>'airport',''),80),'durationMinutes',case when (value->'connection'->>'durationMinutes') ~ '^\d{1,5}$' then (value->'connection'->>'durationMinutes')::integer end)) end,
      'detailUrl', nullif(value->>'detailUrl','')
    ));
    insert into public.guide_flight_records(guide_id,record_id,flight_data,updated_by_device,updated_at,updated_by)
    values(p_guide_id,value->>'id',clean,p_device_token,now(),auth.uid());
    count_records := count_records + 1;
  end loop;
  return jsonb_build_object('count',count_records);
end; $$;

revoke all on function public.replace_guide_flight_records(text,jsonb,text) from public,anon;
grant execute on function public.replace_guide_flight_records(text,jsonb,text) to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='guide_flight_records') then
    alter publication supabase_realtime add table public.guide_flight_records;
  end if;
end $$;
