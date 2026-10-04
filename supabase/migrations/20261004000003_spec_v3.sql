-- Trilha · extensões para o SPEC v3 (identidade por destino, IA contextual, offline,
-- notificações e analytics). Só acrescenta colunas/tabelas: nada é apagado.

-- ───────────────────────── Viagem e identidade ─────────────────────────
alter table public.trips
  add column if not exists origin text check (char_length(origin) <= 60),
  add column if not exists style text not null default 'Mochilão'
    check (style in ('Mochilão', 'Conforto', 'Aventura', 'Cultural')),
  add column if not exists return_at timestamptz,
  -- DestinationIdentity validada (SPEC §3). Persistida: não muda sozinha ao recarregar.
  add column if not exists identity jsonb,
  add column if not exists identity_version integer not null default 1 check (identity_version >= 1);

alter table public.trips drop constraint if exists trips_identity_shape;
alter table public.trips add constraint trips_identity_shape
  check (identity is null or (jsonb_typeof(identity) = 'object' and identity ? 'palette' and identity ? 'slit'));

-- ───────────────────────── Roteiro ─────────────────────────
alter table public.stops
  add column if not exists code text check (code ~ '^[A-Z0-9]{2,4}$'),
  add column if not exists meta text check (char_length(meta) <= 80),
  -- AiTip { text, kind, source?, by: 'ai'|'rules', model?, generated_at }
  add column if not exists tip jsonb check (tip is null or jsonb_typeof(tip) = 'object');

alter table public.transports
  add column if not exists duration_min integer check (duration_min between 1 and 10080),
  add column if not exists document_id uuid references public.documents (id) on delete set null;

alter table public.stays
  add column if not exists document_id uuid references public.documents (id) on delete set null,
  add column if not exists suggested_by text check (suggested_by in ('ai', 'rules'));

alter table public.activities
  add column if not exists suggested_by text check (suggested_by in ('ai', 'rules'));

-- ───────────────────────── Documentos ─────────────────────────
alter table public.documents
  add column if not exists subtitle text check (char_length(subtitle) <= 120),
  add column if not exists classified_by text check (classified_by in ('user', 'ai', 'rules')),
  add column if not exists ai_confidence numeric(3, 2) check (ai_confidence between 0 and 1),
  add column if not exists is_shot boolean not null default false; -- "Fotos e prints"

-- Preferência "manter offline" é por pessoa (segue a conta entre aparelhos).
-- O estado "baixado neste aparelho" fica só no IndexedDB do dispositivo.
create table if not exists public.document_offline_prefs (
  user_id uuid not null references auth.users (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,
  keep_offline boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, document_id)
);
alter table public.document_offline_prefs enable row level security;
create policy offline_prefs_all on public.document_offline_prefs for all to authenticated
  using (user_id = (select auth.uid()) and public.can_read_document(document_id))
  with check (user_id = (select auth.uid()) and public.can_read_document(document_id));

-- ───────────────────────── Mala e pendências ─────────────────────────
alter table public.packing_items
  add column if not exists suggested_by text check (suggested_by in ('ai', 'rules'));

alter table public.tasks
  add column if not exists detail text check (char_length(detail) <= 300),
  add column if not exists link text not null default 'roteiro'
    check (link in ('documentos', 'mala', 'roteiro', 'turma')),
  add column if not exists source text not null default 'user' check (source in ('user', 'ai', 'rules')),
  -- chave estável de alertas gerados (ex.: "insurance-gap"), evita duplicar a mesma pendência
  add column if not exists alert_key text check (char_length(alert_key) <= 80),
  add column if not exists dismissed boolean not null default false;
create unique index if not exists tasks_alert_key_uniq on public.tasks (trip_id, alert_key) where alert_key is not null;

-- ───────────────────────── Diário ─────────────────────────
alter table public.journal_entries
  add column if not exists kind text not null default 'registro' check (kind in ('inspiracao', 'registro')),
  add column if not exists place_name text check (char_length(place_name) <= 120);

-- Retrospectiva gerada (texto/roteiro). Só quem edita gera; todos da viagem leem.
create table if not exists public.trip_retros (
  trip_id uuid primary key references public.trips (id) on delete cascade,
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  generated_by text not null check (generated_by in ('ai', 'rules')),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.trip_retros enable row level security;
create policy retros_select on public.trip_retros for select to authenticated using (public.is_trip_member(trip_id));
create policy retros_insert on public.trip_retros for insert to authenticated with check (public.can_edit_trip(trip_id));
create policy retros_update on public.trip_retros for update to authenticated
  using (public.can_edit_trip(trip_id)) with check (public.can_edit_trip(trip_id));
create policy retros_delete on public.trip_retros for delete to authenticated using (public.can_edit_trip(trip_id));

-- ───────────────────────── Notificações ─────────────────────────
create table if not exists public.notification_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  push_enabled boolean not null default false,
  task_reminders boolean not null default true,
  departure_reminders boolean not null default true,
  weather boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.notification_prefs enable row level security;
create policy notification_prefs_all on public.notification_prefs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh text not null check (char_length(p256dh) <= 200),
  auth text not null check (char_length(auth) <= 100),
  user_agent text check (char_length(user_agent) <= 300),
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
create policy push_subscriptions_all on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ───────────────────────── Analytics (opt-in) ─────────────────────────
alter table public.profiles
  add column if not exists analytics_opt_in boolean not null default false;

create table if not exists public.analytics_events (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  trip_id uuid references public.trips (id) on delete set null,
  name text not null check (name ~ '^[a-z][a-z0-9_.]{1,48}$'),
  props jsonb not null default '{}'::jsonb check (jsonb_typeof(props) = 'object' and pg_column_size(props) <= 2000),
  created_at timestamptz not null default now()
);
create index if not exists analytics_events_name_idx on public.analytics_events (name, created_at);
alter table public.analytics_events enable row level security;
-- Só grava eventos de quem aceitou; ninguém lê pelo app (consulta pelo painel do Supabase).
create policy analytics_insert on public.analytics_events for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.analytics_opt_in)
    and (trip_id is null or public.is_trip_member(trip_id))
  );

-- ───────────────────────── Uso de IA (limite por pessoa) ─────────────────────────
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null default current_date,
  calls integer not null default 0 check (calls >= 0),
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
create policy ai_usage_select on public.ai_usage for select to authenticated using (user_id = (select auth.uid()));

-- Incrementa e devolve o uso do dia de forma atômica (chamado pelas rotas /api/ai/*).
create or replace function public.consume_ai_call(p_limit integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_calls integer;
begin
  if (select auth.uid()) is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;
  insert into public.ai_usage (user_id, day, calls) values ((select auth.uid()), current_date, 1)
  on conflict (user_id, day) do update set calls = public.ai_usage.calls + 1
  returning calls into v_calls;
  if v_calls > p_limit then
    raise exception 'Limite diário de IA atingido' using errcode = 'P0001';
  end if;
  return v_calls;
end;
$$;

-- ───────────────────────── Permissões ─────────────────────────
grant select, insert, update, delete on public.document_offline_prefs, public.trip_retros,
  public.notification_prefs, public.push_subscriptions to authenticated;
grant insert on public.analytics_events to authenticated;
grant select on public.ai_usage to authenticated;
revoke all on public.analytics_events, public.ai_usage from anon;
revoke execute on all functions in schema public from public, anon;
grant execute on function public.consume_ai_call(integer) to authenticated;
grant execute on function
  public.trip_role(uuid), public.is_trip_member(uuid), public.can_edit_trip(uuid),
  public.is_trip_organizer(uuid), public.shares_trip_with(uuid),
  public.can_read_document(uuid), public.owns_document(uuid), public.require_trip_member(uuid, uuid),
  public.document_shared_with_me(uuid), public.document_trip_has_member(uuid, uuid),
  public.create_invite(uuid, public.member_role, integer, integer), public.preview_invite(text),
  public.accept_invite(text), public.save_expense(jsonb, jsonb), public.storage_trip_id(text)
  to authenticated;

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['trip_retros'] loop
      begin
        execute format('alter publication supabase_realtime add table public.%I', t);
      exception when duplicate_object then null;
      end;
    end loop;
  end if;
end;
$$;
