-- Ajuste de 08/11/2026: dormir numa cidade vizinha mais barata ("cidade-dormitório").
-- Aditiva: a parada guarda a base de hospedagem escolhida (ex.: Costa Amalfitana → Salerno), com o trajeto diário
-- por pessoa. null = dorme na própria cidade. O app lê o campo como opcional (funciona antes da migration).

alter table public.stops
  add column if not exists stay_base jsonb check (
    stay_base is null or coalesce(
      jsonb_typeof(stay_base) = 'object'
      and jsonb_typeof(stay_base -> 'name') = 'string'
      and char_length(stay_base ->> 'name') between 2 and 80
      and octet_length(stay_base::text) <= 2000,
      false
    )
  );

-- apply_onboarding_route passa a gravar stay_base de cada parada (resto igual à 0010).
create or replace function public.apply_onboarding_route(
  p_trip uuid, p_version integer, p_route jsonb, p_replace boolean default false
) returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_version integer;
  v_currency text;
  v_ids uuid[] := '{}';
  v_id uuid;
  r jsonb;
  i integer := 0;
begin
  if not public.can_edit_trip(p_trip) then
    raise exception 'Só quem edita a trilha pode montar o roteiro' using errcode = '42501';
  end if;
  select version, base_currency into v_version, v_currency from public.trips where id = p_trip for update;
  if v_version is distinct from p_version then
    raise exception 'A viagem mudou em outra tela. Recarregue para continuar.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_route) <> 'object' or jsonb_typeof(p_route -> 'stops') <> 'array' or jsonb_array_length(p_route -> 'stops') = 0 then
    raise exception 'Roteiro inválido' using errcode = '22023';
  end if;

  if exists (select 1 from public.stops where trip_id = p_trip) then
    if not p_replace then
      raise exception 'Já existe um roteiro nesta trilha.' using errcode = 'P0002';
    end if;
    -- Gasto ligado a um item é dinheiro de verdade: não some junto com o roteiro.
    -- Documentos, diário e votações só perdem o vínculo com a parada (on delete set null).
    if exists (
      select 1 from public.expenses e where e.trip_id = p_trip
        and (e.activity_id is not null or e.stay_id is not null or e.transport_id is not null)
    ) then
      raise exception 'O roteiro atual tem gastos ligados a trechos, hospedagens ou passeios. Ajuste pelo Roteiro.' using errcode = 'P0001';
    end if;
    delete from public.stops where trip_id = p_trip;
  end if;

  for r in select * from jsonb_array_elements(p_route -> 'stops') loop
    insert into public.stops (id, trip_id, position, name, country, lat, lng, arrival_date, departure_date, arrival_mode, stay_base)
      values (
        coalesce((r ->> 'id')::uuid, gen_random_uuid()), p_trip, i, left(r ->> 'name', 80), nullif(left(coalesce(r ->> 'country', ''), 60), ''),
        (r ->> 'lat')::double precision, (r ->> 'lng')::double precision,
        (r ->> 'arrival_date')::date, (r ->> 'departure_date')::date,
        (r ->> 'arrival_mode')::public.transport_mode,
        case when jsonb_typeof(r -> 'stay_base') = 'object' then r -> 'stay_base' else null end
      ) returning id into v_id;
    v_ids := v_ids || v_id;
    i := i + 1;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_route -> 'legs', '[]'::jsonb)) loop
    insert into public.transports (trip_id, stop_id, mode, origin_name, dest_name, depart_date, duration_min,
        price_cents, price_currency, price_is_estimate, is_return)
      values (
        p_trip, v_ids[(r ->> 'stop_index')::integer + 1], coalesce((r ->> 'mode')::public.transport_mode, 'other'),
        nullif(left(coalesce(r ->> 'origin_name', ''), 80), ''), nullif(left(coalesce(r ->> 'dest_name', ''), 80), ''),
        (r ->> 'depart_date')::date, (r ->> 'duration_min')::integer,
        (r ->> 'price_cents')::bigint, case when r ->> 'price_cents' is null then null else v_currency end,
        true, coalesce((r ->> 'is_return')::boolean, false)
      );
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_route -> 'suggestions', '[]'::jsonb)) loop
    insert into public.suggestions (trip_id, stop_id, kind, day, payload, status, source)
      values (p_trip, v_ids[(r ->> 'stop_index')::integer + 1], 'activity', (r ->> 'day')::integer,
        r -> 'payload', coalesce(r ->> 'status', 'new'), 'ai');
  end loop;

  update public.trips set
    budget_plan = coalesce(p_route -> 'budget_plan', budget_plan),
    onboarding = coalesce(p_route -> 'onboarding', onboarding)
  where id = p_trip;
end;
$$;
revoke all on function public.apply_onboarding_route(uuid, integer, jsonb, boolean) from public, anon;
grant execute on function public.apply_onboarding_route(uuid, integer, jsonb, boolean) to authenticated;
