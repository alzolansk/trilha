-- Trilha 2.0 · dados do redesign (planning.md §7).
-- Tudo aditivo: nada é apagado. Colunas de identidade antigas (trips.identity) continuam, sem uso novo.
-- Padrões das migrações anteriores: FKs compostas com trip_id, RLS por papel, bump_version, realtime.

-- ───────────────────────── Auxiliares ─────────────────────────
-- Luminância relativa (WCAG) de um hex #RRGGBB. Usada só no backfill de trips.accent.
create or replace function public.hex_luminance(p_hex text)
returns double precision
language sql
immutable
set search_path = ''
as $$
  with c as (
    select ('x' || substr(p_hex, 2, 2))::bit(8)::int / 255.0 as r,
           ('x' || substr(p_hex, 4, 2))::bit(8)::int / 255.0 as g,
           ('x' || substr(p_hex, 6, 2))::bit(8)::int / 255.0 as b
  ), l as (
    select case when r <= 0.03928 then r / 12.92 else power((r + 0.055) / 1.055, 2.4) end as r,
           case when g <= 0.03928 then g / 12.92 else power((g + 0.055) / 1.055, 2.4) end as g,
           case when b <= 0.03928 then b / 12.92 else power((b + 0.055) / 1.055, 2.4) end as b
      from c
  )
  select 0.2126 * r + 0.7152 * g + 0.0722 * b from l;
$$;

-- Foto escolhida: {url (https), author, license, source_url} da Wikimedia, ou {path} de upload próprio.
create or replace function public.valid_photo(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is null or (
    jsonb_typeof(p) = 'object'
    and pg_column_size(p) <= 4000
    and (coalesce(p ->> 'url', '') ~ '^https://' or coalesce(p ->> 'path', '') <> '')
  );
$$;

-- ───────────────────────── Trilha ─────────────────────────
alter table public.trips
  add column if not exists accent text check (accent is null or accent ~ '^#[0-9A-Fa-f]{6}$'),
  add column if not exists budget_plan jsonb check (budget_plan is null or (jsonb_typeof(budget_plan) = 'object' and pg_column_size(budget_plan) <= 16000));

-- Backfill: destino do dicionário → cor curada; acento da identidade antiga só se passar 3:1 com
-- branco (luminância ≤ 0,30). Os demais ficam null = "automático" (o app escurece via safeAccent).
update public.trips t set accent = case t.identity ->> 'key'
    when 'andes' then '#C8452C' when 'japao' then '#C2272D'
    when 'marrocos' then '#1F5FA8' when 'islandia' then '#1F6F8B'
  end
 where t.accent is null and t.identity ->> 'key' in ('andes', 'japao', 'marrocos', 'islandia');
update public.trips t set accent = upper(t.identity -> 'palette' ->> 'acc')
 where t.accent is null
   and coalesce(t.identity -> 'palette' ->> 'acc', '') ~ '^#[0-9A-Fa-f]{6}$'
   and public.hex_luminance(t.identity -> 'palette' ->> 'acc') <= 0.30;

-- ───────────────────────── Custos nos itens do roteiro ─────────────────────────
-- Centavos inteiros. *_is_estimate = true enquanto a turma não confirmar o valor.
alter table public.transports
  add column if not exists price_cents bigint check (price_cents is null or price_cents between 0 and 100000000000),
  add column if not exists price_currency char(3) check (price_currency is null or price_currency ~ '^[A-Z]{3}$'),
  add column if not exists price_is_estimate boolean not null default true;
alter table public.transports add constraint transports_price_currency
  check ((price_cents is null) = (price_currency is null));

-- stays.price_cents = por noite, quarto/casa inteiro.
alter table public.stays
  add column if not exists price_cents bigint check (price_cents is null or price_cents between 0 and 100000000000),
  add column if not exists price_currency char(3) check (price_currency is null or price_currency ~ '^[A-Z]{3}$'),
  add column if not exists price_is_estimate boolean not null default true,
  add column if not exists link_url text check (link_url is null or (char_length(link_url) <= 500 and link_url ~ '^https?://'));
alter table public.stays add constraint stays_price_currency
  check ((price_cents is null) = (price_currency is null));

-- activities.cost_cents = por pessoa (para de usar notes para guardar custo).
alter table public.activities
  add column if not exists cost_cents bigint check (cost_cents is null or cost_cents between 0 and 100000000000),
  add column if not exists cost_currency char(3) check (cost_currency is null or cost_currency ~ '^[A-Z]{3}$'),
  add column if not exists cost_is_estimate boolean not null default true,
  add column if not exists photo jsonb check (public.valid_photo(photo));
alter table public.activities add constraint activities_cost_currency
  check ((cost_cents is null) = (cost_currency is null));

alter table public.stops
  add column if not exists area text check (char_length(area) <= 80),
  add column if not exists photo jsonb check (public.valid_photo(photo));

-- ───────────────────────── Gasto ↔ item ─────────────────────────
-- FKs compostas precisam de unique (id, trip_id) nas tabelas de destino.
alter table public.activities add constraint activities_id_trip_uniq unique (id, trip_id);
alter table public.stays add constraint stays_id_trip_uniq unique (id, trip_id);
alter table public.transports add constraint transports_id_trip_uniq unique (id, trip_id);

alter table public.expenses
  add column if not exists activity_id uuid,
  add column if not exists stay_id uuid,
  add column if not exists transport_id uuid;
alter table public.expenses
  add constraint expenses_activity_fk foreign key (activity_id, trip_id)
    references public.activities (id, trip_id) on delete set null (activity_id),
  add constraint expenses_stay_fk foreign key (stay_id, trip_id)
    references public.stays (id, trip_id) on delete set null (stay_id),
  add constraint expenses_transport_fk foreign key (transport_id, trip_id)
    references public.transports (id, trip_id) on delete set null (transport_id),
  -- um gasto paga no máximo um item
  add constraint expenses_one_link check (num_nonnulls(activity_id, stay_id, transport_id) <= 1);
create index if not exists expenses_activity_idx on public.expenses (activity_id) where activity_id is not null;
create index if not exists expenses_stay_idx on public.expenses (stay_id) where stay_id is not null;
create index if not exists expenses_transport_idx on public.expenses (transport_id) where transport_id is not null;

-- ───────────────────────── Categorias e caixa ─────────────────────────
alter table public.budget_categories
  add column if not exists kind text not null default 'outro'
    check (kind in ('transporte', 'hospedagem', 'passeios', 'comida', 'outro'));
create or replace function public.budget_kind_of(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when lower(p_name) like '%transp%' or lower(p_name) like '%passage%' then 'transporte'
    when lower(p_name) like '%hosped%' or lower(p_name) like '%estadia%' then 'hospedagem'
    when lower(p_name) like '%passeio%' or lower(p_name) like '%atividade%' or lower(p_name) like '%ingresso%' then 'passeios'
    when lower(p_name) like '%comida%' or lower(p_name) like '%aliment%' or lower(p_name) like '%refei%' then 'comida'
    else 'outro'
  end;
$$;
update public.budget_categories set kind = public.budget_kind_of(name) where kind = 'outro';

-- Versões do app que ainda não mandam `kind` (ou inserem sem ele) ganham o tipo pelo nome.
create or replace function public.default_budget_kind()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind = 'outro' then
    new.kind := public.budget_kind_of(new.name);
  end if;
  return new;
end;
$$;
create trigger budget_categories_kind before insert on public.budget_categories
  for each row execute function public.default_budget_kind();

-- Cota individual no caixa (null = planejado ÷ número de pessoas). Só o organizador edita (members_update).
alter table public.trip_members
  add column if not exists pool_target_cents bigint check (pool_target_cents is null or pool_target_cents between 0 and 100000000000);

-- Quem leva o item da mala.
alter table public.packing_items
  add column if not exists assignee_id uuid references auth.users (id) on delete set null;

create or replace function public.check_expense_people()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'expenses' then
    perform public.require_trip_member(new.trip_id, new.payer_id);
  elsif tg_table_name = 'expense_shares' then
    perform public.require_trip_member(new.trip_id, new.user_id);
  elsif tg_table_name = 'settlements' then
    perform public.require_trip_member(new.trip_id, new.from_user);
    perform public.require_trip_member(new.trip_id, new.to_user);
  elsif tg_table_name = 'pool_contributions' then
    perform public.require_trip_member(new.trip_id, new.user_id);
  elsif tg_table_name in ('tasks', 'packing_items') and new.assignee_id is not null then
    perform public.require_trip_member(new.trip_id, new.assignee_id);
  end if;
  return new;
end;
$$;
create trigger packing_items_people before insert or update of assignee_id on public.packing_items
  for each row execute function public.check_expense_people();

-- ───────────────────────── save_expense com vínculo ─────────────────────────
-- Aceita activity_id / stay_id / transport_id. A FK composta já garante que o item é da mesma
-- trilha; o check abaixo só deixa a mensagem humana.
create or replace function public.save_expense(p_expense jsonb, p_shares jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := nullif(p_expense ->> 'id', '')::uuid;
  v_trip uuid := (p_expense ->> 'trip_id')::uuid;
  v_version integer := nullif(p_expense ->> 'version', '')::integer;
  v_base numeric(14, 2) := (p_expense ->> 'base_amount')::numeric;
  v_pool boolean := coalesce((p_expense ->> 'paid_from_pool')::boolean, false);
  v_activity uuid := nullif(p_expense ->> 'activity_id', '')::uuid;
  v_stay uuid := nullif(p_expense ->> 'stay_id', '')::uuid;
  v_transport uuid := nullif(p_expense ->> 'transport_id', '')::uuid;
  v_sum bigint;
  v_rows integer;
begin
  select coalesce(sum((s ->> 'share_cents')::bigint), 0) into v_sum
    from jsonb_array_elements(p_shares) s;
  if jsonb_array_length(p_shares) = 0 then
    raise exception 'Escolha pelo menos uma pessoa no rateio' using errcode = '22023';
  end if;
  if v_sum <> round(v_base * 100)::bigint then
    raise exception 'O rateio (% centavos) não fecha com o total (% centavos)', v_sum, round(v_base * 100)
      using errcode = '22023';
  end if;
  if num_nonnulls(v_activity, v_stay, v_transport) > 1 then
    raise exception 'Um gasto paga no máximo um item do roteiro' using errcode = '22023';
  end if;
  if (v_activity is not null and not exists (select 1 from public.activities a where a.id = v_activity and a.trip_id = v_trip))
     or (v_stay is not null and not exists (select 1 from public.stays s where s.id = v_stay and s.trip_id = v_trip))
     or (v_transport is not null and not exists (select 1 from public.transports t where t.id = v_transport and t.trip_id = v_trip)) then
    raise exception 'O item ligado ao gasto não é desta viagem' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.expenses (trip_id, description, category_id, stop_id, payer_id, amount, currency,
      rate_to_base, rate_source, rate_date, rate_is_manual, base_amount, spent_on, paid_from_pool,
      activity_id, stay_id, transport_id)
    values (v_trip, p_expense ->> 'description', nullif(p_expense ->> 'category_id', '')::uuid,
      nullif(p_expense ->> 'stop_id', '')::uuid, (p_expense ->> 'payer_id')::uuid,
      (p_expense ->> 'amount')::numeric, p_expense ->> 'currency',
      (p_expense ->> 'rate_to_base')::numeric, p_expense ->> 'rate_source',
      (p_expense ->> 'rate_date')::date, coalesce((p_expense ->> 'rate_is_manual')::boolean, false),
      v_base, (p_expense ->> 'spent_on')::date, v_pool, v_activity, v_stay, v_transport)
    returning id into v_id;
  else
    update public.expenses set
      description = p_expense ->> 'description',
      category_id = nullif(p_expense ->> 'category_id', '')::uuid,
      stop_id = nullif(p_expense ->> 'stop_id', '')::uuid,
      payer_id = (p_expense ->> 'payer_id')::uuid,
      amount = (p_expense ->> 'amount')::numeric,
      currency = p_expense ->> 'currency',
      rate_to_base = (p_expense ->> 'rate_to_base')::numeric,
      rate_source = p_expense ->> 'rate_source',
      rate_date = (p_expense ->> 'rate_date')::date,
      rate_is_manual = coalesce((p_expense ->> 'rate_is_manual')::boolean, false),
      base_amount = v_base,
      spent_on = (p_expense ->> 'spent_on')::date,
      paid_from_pool = v_pool,
      activity_id = v_activity,
      stay_id = v_stay,
      transport_id = v_transport
    where id = v_id and trip_id = v_trip and version = v_version;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'Este gasto foi alterado ou removido por outra pessoa' using errcode = '40001';
    end if;
    delete from public.expense_shares where expense_id = v_id;
  end if;

  insert into public.expense_shares (expense_id, trip_id, user_id, share_cents)
  select v_id, v_trip, (s ->> 'user_id')::uuid, (s ->> 'share_cents')::bigint
    from jsonb_array_elements(p_shares) s;
  return v_id;
end;
$$;

-- ───────────────────────── Sugestões ─────────────────────────
-- Geradas pela IA (passeios, bairros, destinos) ou por regras (lembretes). A turma aceita,
-- leva para votação ou dispensa. Decisão: só organizador/editores mudam o status (inclusive
-- dispensar); o leitor vê e vota no poll gerado, como em todo o resto.
create table public.suggestions (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  stop_id uuid,
  kind text not null check (kind in ('destination', 'activity', 'area', 'reminder')),
  day integer check (day is null or day between 1 and 400),
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 8000 and coalesce(payload ->> 'title', '') <> ''),
  status text not null default 'new' check (status in ('new', 'accepted', 'voting', 'dismissed')),
  source text not null default 'ai' check (source in ('ai', 'rules')),
  acted_by uuid references auth.users (id) on delete set null,
  acted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique (id, trip_id),
  foreign key (stop_id, trip_id) references public.stops (id, trip_id) on delete cascade
);
create index suggestions_trip_idx on public.suggestions (trip_id, status, created_at);
create index suggestions_stop_idx on public.suggestions (stop_id) where stop_id is not null;
create trigger suggestions_version before update on public.suggestions
  for each row execute function public.bump_version();

-- Quem age fica registrado pelo servidor (não pelo cliente).
create or replace function public.stamp_suggestion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.trip_id <> old.trip_id) then
    raise exception 'A sugestão não muda de viagem' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'new' then
      new.acted_by := (select auth.uid());
      new.acted_at := now();
    end if;
  elsif new.status is distinct from old.status then
    new.acted_by := (select auth.uid());
    new.acted_at := now();
  end if;
  return new;
end;
$$;
create trigger suggestions_stamp before insert or update on public.suggestions
  for each row execute function public.stamp_suggestion();

-- ───────────────────────── Preferências (questionário do Descobrir) ─────────────────────────
create table public.trip_preferences (
  trip_id uuid not null references public.trips (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  answers jsonb not null default '{}'::jsonb
    check (jsonb_typeof(answers) = 'object' and pg_column_size(answers) <= 4000),
  updated_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);

create or replace function public.touch_preferences()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.trip_id <> old.trip_id or new.user_id <> old.user_id) then
    raise exception 'A preferência não muda de viagem nem de pessoa' using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger trip_preferences_touch before insert or update on public.trip_preferences
  for each row execute function public.touch_preferences();

-- Quem sai da viagem leva junto as próprias respostas.
create or replace function public.drop_member_preferences()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.trip_preferences p where p.trip_id = old.trip_id and p.user_id = old.user_id;
  return old;
end;
$$;
create trigger trip_members_drop_preferences after delete on public.trip_members
  for each row execute function public.drop_member_preferences();

-- ───────────────────────── RLS ─────────────────────────
alter table public.suggestions enable row level security;
revoke all on public.suggestions from anon;
grant select, insert, update, delete on public.suggestions to authenticated;
create policy suggestions_select on public.suggestions for select to authenticated
  using (public.is_trip_member(trip_id));
create policy suggestions_insert on public.suggestions for insert to authenticated
  with check (public.can_edit_trip(trip_id));
create policy suggestions_update on public.suggestions for update to authenticated
  using (public.can_edit_trip(trip_id)) with check (public.can_edit_trip(trip_id));
create policy suggestions_delete on public.suggestions for delete to authenticated
  using (public.can_edit_trip(trip_id));

-- Todos da viagem leem as respostas (o Descobrir mostra o que a turma quer); cada um edita a sua.
alter table public.trip_preferences enable row level security;
revoke all on public.trip_preferences from anon;
grant select, insert, update, delete on public.trip_preferences to authenticated;
create policy trip_preferences_select on public.trip_preferences for select to authenticated
  using (public.is_trip_member(trip_id));
create policy trip_preferences_insert on public.trip_preferences for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_trip_member(trip_id));
create policy trip_preferences_update on public.trip_preferences for update to authenticated
  using (user_id = (select auth.uid()) and public.is_trip_member(trip_id))
  with check (user_id = (select auth.uid()) and public.is_trip_member(trip_id));
create policy trip_preferences_delete on public.trip_preferences for delete to authenticated
  using (user_id = (select auth.uid()));

-- ───────────────────────── Funções ─────────────────────────
revoke execute on function public.stamp_suggestion(), public.touch_preferences(), public.drop_member_preferences(), public.default_budget_kind()
  from public, anon, authenticated;
revoke execute on function public.check_expense_people() from public, anon, authenticated;
grant execute on function public.save_expense(jsonb, jsonb) to authenticated;

-- ───────────────────────── Realtime ─────────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.suggestions;
    alter publication supabase_realtime add table public.trip_preferences;
  end if;
end;
$$;
