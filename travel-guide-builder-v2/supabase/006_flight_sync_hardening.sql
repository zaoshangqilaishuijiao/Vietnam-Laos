-- Run once after 005. No historical rows are deleted or rewritten by this migration.
begin;
alter table public.guide_flight_records add column if not exists record_index integer not null default 0;
revoke insert, update, delete on public.guide_flight_records from public, anon, authenticated;
drop policy if exists "members manage flight records" on public.guide_flight_records;
drop policy if exists "members read flight records" on public.guide_flight_records;
create policy "members read flight records" on public.guide_flight_records for select to authenticated
  using (public.is_guide_member(guide_id));

create or replace function public.guide_flight_safe_url(raw text)
returns boolean language plpgsql immutable set search_path = public as $$
declare decoded text := raw; piece text; previous text;
begin
  if raw is null or raw = '' then return true; end if;
  if raw !~* '^https://[^/?#[:space:]]+' then return false; end if;
  for i in 1..3 loop
    previous := decoded;
    for piece in select m[1] from regexp_matches(decoded, '((%[0-9a-fA-F]{2})+)', 'g') m loop
      decoded := replace(decoded, piece, convert_from(decode(replace(piece, '%', ''), 'hex'), 'UTF8'));
    end loop;
    exit when previous = decoded;
  end loop;
  return decoded !~* '%[0-9a-f]{2}|[[:space:]]|pnr|passenger|passport|ticket[-_ ]?(no|number)|order[-_ ]?(id|no|number)|booking[-_ ]?(ref|reference)|姓名|证件|订单|票号|乘机人'
    and position(chr(92) in decoded) = 0 and decoded !~* '^https://[^/?#]*@';
exception when others then return false;
end; $$;
revoke all on function public.guide_flight_safe_url(text) from public, anon, authenticated;

create or replace function public.replace_guide_flight_records(p_guide_id text, p_records jsonb, p_device_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare value jsonb; field text; count_records integer := 0; ids text[] := '{}';
  allowed text[] := array['id','legLabel','flightNumber','airline','departureDate','arrivalDate','departureTime','arrivalTime','departureCode','arrivalCode','departureAirport','arrivalAirport','departureTerminal','arrivalTerminal','durationMinutes','seat','gate','baggageClaim','connection','detailUrl'];
begin
  if auth.uid() is null then raise exception 'sign-in required'; end if;
  if not exists (select 1 from public.guide_collab_members where guide_id=p_guide_id and user_id=auth.uid()) then raise exception 'editor required'; end if;
  if not exists (select 1 from public.guide_collab_device_sessions where guide_id=p_guide_id and device_token=p_device_token and user_id=auth.uid()) then raise exception 'device session invalid'; end if;
  if p_records is null or jsonb_typeof(p_records) <> 'array' or jsonb_array_length(p_records) > 16 then raise exception 'invalid flight record group'; end if;
  -- Every writer for this guide locks the same existing parent row, even for an empty group.
  perform 1 from public.guide_collab_trips where guide_id=p_guide_id for update;
  if not found then raise exception 'guide not found'; end if;
  -- Validate the whole group before replacing it. Any error rolls back the entire RPC.
  for value in select * from jsonb_array_elements(p_records) loop
    if jsonb_typeof(value) <> 'object' then raise exception 'invalid flight record'; end if;
    if exists (select 1 from jsonb_object_keys(value) k where not (k=any(allowed))) then raise exception 'unsupported flight field'; end if;
    for field in select jsonb_object_keys(value) loop
      if field not in ('connection','durationMinutes') and jsonb_typeof(value->field) not in ('string','null') then raise exception 'invalid field type'; end if;
    end loop;
    if coalesce(value->>'id','') !~ '^[a-zA-Z0-9_-]{8,160}$' or (value->>'id')=any(ids) then raise exception 'invalid or duplicate record id'; end if;
    ids := array_append(ids,value->>'id');
    if coalesce(value->>'flightNumber','') !~ '^[A-Z0-9]{2}[0-9]{3,4}$' then raise exception 'invalid flight number'; end if;
    if coalesce(value->>'legLabel','') not in ('','去程','返程') then raise exception 'invalid leg label'; end if;
    foreach field in array array['airline','departureAirport','arrivalAirport'] loop
      if jsonb_typeof(value->field) <> 'string' or length(btrim(coalesce(value->>field,''))) not between 1 and 80 then raise exception 'invalid flight text'; end if;
    end loop;
    foreach field in array array['airline','departureAirport','arrivalAirport'] loop
      if value->>field ~* '姓名|乘机人|旅客|证件|护照|订单|票号|二维码|条码|条形码|pnr|passenger|passport|ticket[ _]*(no|number)|booking[ _]*ref|[<>]' then raise exception 'sensitive flight text'; end if;
    end loop;
    foreach field in array array['departureCode','arrivalCode'] loop
      if coalesce(value->>field,'') <> '' and value->>field !~ '^[A-Z]{3}$' then raise exception 'invalid airport code'; end if;
    end loop;
    foreach field in array array['departureTerminal','arrivalTerminal','seat','gate','baggageClaim'] loop
      if coalesce(value->>field,'') <> '' and value->>field !~ '^[A-Z0-9 -]{1,12}$' then raise exception 'invalid execution code'; end if;
    end loop;
    foreach field in array array['departureDate','arrivalDate'] loop
      if coalesce(value->>field,'') <> '' then
        if value->>field !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or to_char((value->>field)::date,'YYYY-MM-DD') <> value->>field then raise exception 'invalid flight date'; end if;
      end if;
    end loop;
    foreach field in array array['departureTime','arrivalTime'] loop
      if coalesce(value->>field,'') <> '' and value->>field !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'invalid flight time'; end if;
    end loop;
    if coalesce(value->>'durationMinutes','') <> '' then
      if value->>'durationMinutes' !~ '^[0-9]{1,4}$' or (value->>'durationMinutes')::integer not between 1 and 2880 then raise exception 'invalid duration'; end if;
    end if;
    if value->'connection' is not null and value->'connection' <> 'null'::jsonb then
      if jsonb_typeof(value->'connection') <> 'object' then raise exception 'invalid connection'; end if;
      if exists (select 1 from jsonb_object_keys(value->'connection') k where k not in ('airportCode','airport','durationMinutes')) then raise exception 'unsupported connection field'; end if;
      foreach field in array array['airportCode','airport'] loop
        if jsonb_typeof(value->'connection'->field) not in ('string','null') then raise exception 'invalid connection field type'; end if;
      end loop;
      if coalesce(value->'connection'->>'airportCode','') <> '' and value->'connection'->>'airportCode' !~ '^[A-Z]{3}$' then raise exception 'invalid connection code'; end if;
      if length(coalesce(value->'connection'->>'airport','')) > 80 or value->'connection'->>'airport' ~* '姓名|乘机人|旅客|证件|护照|订单|票号|二维码|条码|条形码|pnr|passenger|passport|ticket[ _]*(no|number)|booking[ _]*ref|[<>]' then raise exception 'invalid connection text'; end if;
      if coalesce(value->'connection'->>'durationMinutes','') <> '' then
        if value->'connection'->>'durationMinutes' !~ '^[0-9]{1,5}$' or (value->'connection'->>'durationMinutes')::integer not between 1 and 10080 then raise exception 'invalid connection duration'; end if;
      end if;
    end if;
    if not public.guide_flight_safe_url(value->>'detailUrl') then raise exception 'unsafe flight link'; end if;
  end loop;
  delete from public.guide_flight_records where guide_id=p_guide_id;
  for value in select * from jsonb_array_elements(p_records) loop
    insert into public.guide_flight_records(guide_id,record_id,flight_data,record_index,updated_by_device,updated_at,updated_by)
    values(p_guide_id,value->>'id',jsonb_strip_nulls(value),count_records,p_device_token,clock_timestamp(),auth.uid());
    count_records := count_records + 1;
  end loop;
  return jsonb_build_object('count',count_records);
end; $$;
revoke all on function public.replace_guide_flight_records(text,jsonb,text) from public, anon;
grant execute on function public.replace_guide_flight_records(text,jsonb,text) to authenticated;
commit;
