-- Fase 10 (planning §10.11): onboarding roteirizado.
-- Aditiva: pessoas na viagem, rascunho do onboarding, trecho de volta e a aplicação atômica da rota.

alter table public.trips
  add column if not exists party_size smallint check (party_size is null or party_size between 1 and 50),
  add column if not exists onboarding jsonb check (onboarding is null or (jsonb_typeof(onboarding) = 'object' and pg_column_size(onboarding) <= 60000));

alter table public.transports
  add column if not exists is_return boolean not null default false;
-- No máximo um trecho de volta para casa por trilha.
create unique index if not exists transports_one_return on public.transports (trip_id) where is_return;

-- Aplica a rota sugerida no onboarding numa transação só.
-- p_route: { stops: [{ id?, name, country, lat, lng, arrival_date, departure_date, arrival_mode }],
--            legs:  [{ stop_index, mode, origin_name, dest_name, depart_date, duration_min, price_cents, is_return }],
--            suggestions: [{ stop_index, day, payload, status }],
--            budget_plan: {...} | null, onboarding: {...} | null }
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
    insert into public.stops (id, trip_id, position, name, country, lat, lng, arrival_date, departure_date, arrival_mode)
      values (
        coalesce((r ->> 'id')::uuid, gen_random_uuid()), p_trip, i, left(r ->> 'name', 80), nullif(left(coalesce(r ->> 'country', ''), 60), ''),
        (r ->> 'lat')::double precision, (r ->> 'lng')::double precision,
        (r ->> 'arrival_date')::date, (r ->> 'departure_date')::date,
        (r ->> 'arrival_mode')::public.transport_mode
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
