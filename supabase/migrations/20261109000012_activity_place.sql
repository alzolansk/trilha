-- Ajuste de 09/11/2026: passeios no mapa.
-- Aditiva: a atividade guarda onde acontece (ponto) e, quando é um percurso (trem panorâmico, barco,
-- estrada cênica), o trajeto aproximado em ordem. Formato (ver src/lib/activityPlace.ts):
--   {"name": "...", "lat": 0, "lng": 0, "path": [{"name": "...", "lat": 0, "lng": 0}] | null, "by": "ai|osm|route"}
--   {"none": true, "by": "ai"}  -- já se procurou e não é um lugar (ex.: "tarde livre")
-- O app lê o campo como opcional (funciona antes da migration; só não grava o lugar).

-- Coordenada válida: número dentro da faixa. CASE evita o cast em valores que não são número.
create or replace function public.valid_coord(p jsonb, p_max double precision)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p) = 'number' then abs((p #>> '{}')::double precision) <= p_max else false end;
$$;

create or replace function public.valid_activity_place(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is null or coalesce(
    jsonb_typeof(p) = 'object'
    and octet_length(p::text) <= 4000
    and (
      p -> 'none' = 'true'::jsonb
      or (
        public.valid_coord(p -> 'lat', 90)
        and public.valid_coord(p -> 'lng', 180)
        and (
          p -> 'path' is null
          or p -> 'path' = 'null'::jsonb
          or (
            jsonb_typeof(p -> 'path') = 'array'
            and jsonb_array_length(p -> 'path') between 2 and 12
            and not exists (
              select 1 from jsonb_array_elements(p -> 'path') x
               where jsonb_typeof(x) <> 'object'
                  or not public.valid_coord(x -> 'lat', 90)
                  or not public.valid_coord(x -> 'lng', 180)
            )
          )
        )
      )
    ),
    false
  );
$$;

alter table public.activities
  add column if not exists place jsonb check (public.valid_activity_place(place));
