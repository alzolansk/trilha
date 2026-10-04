-- Trilha · schema principal
-- Tabelas, tipos, integridade e gatilhos. As políticas de acesso ficam em 0002.

-- ───────────────────────── Tipos ─────────────────────────
create type public.member_role as enum ('organizer', 'editor', 'viewer');
create type public.transport_mode as enum ('plane', 'bus', 'train', 'car', 'walk', 'boat', 'other');
create type public.stay_status as enum ('pending', 'booked');
create type public.doc_category as enum ('passagem', 'identidade', 'reserva', 'ingresso', 'seguro', 'outro');
create type public.doc_visibility as enum ('private', 'shared', 'trip');
create type public.doc_status as enum ('uploading', 'ready');
create type public.task_status as enum ('todo', 'doing', 'done');
create type public.journal_phase as enum ('antes', 'durante', 'depois');

-- ───────────────────────── Utilitários ─────────────────────────
-- Incrementa a versão a cada UPDATE. O cliente atualiza com "where version = X";
-- se outra pessoa salvou antes, nenhuma linha muda e o app mostra o conflito.
create or replace function public.bump_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

-- ───────────────────────── Perfis ─────────────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  color text not null default '#FF5A1F' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  palette text[] := array['#FF5A1F', '#C8F031', '#5B8CFF', '#B79CFF', '#FF8FB8', '#FFC93C'];
  name text;
begin
  name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    split_part(coalesce(new.email, 'viajante'), '@', 1)
  );
  insert into public.profiles (id, display_name, color)
  values (new.id, left(name, 60), palette[1 + floor(random() * array_length(palette, 1))::int]);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────────────────── Viagens e membros ─────────────────────────
create table public.trips (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 80),
  tagline text check (char_length(tagline) <= 40),
  destinations text[] not null default '{}' check (cardinality(destinations) <= 20),
  start_date date not null,
  end_date date not null,
  departure_at timestamptz,
  departure_tz text not null default 'America/Sao_Paulo' check (char_length(departure_tz) <= 64),
  home_tz text not null default 'America/Sao_Paulo' check (char_length(home_tz) <= 64),
  base_currency char(3) not null default 'BRL' check (base_currency ~ '^[A-Z]{3}$'),
  budget_total numeric(14, 2) check (budget_total is null or budget_total >= 0),
  cover_path text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  check (end_date >= start_date)
);
create trigger trips_version before update on public.trips
  for each row execute function public.bump_version();

create table public.trip_members (
  trip_id uuid not null references public.trips (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null default 'viewer',
  joined_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);
create index trip_members_user_idx on public.trip_members (user_id);

-- Quem cria a viagem vira organizador automaticamente.
create or replace function public.handle_new_trip()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.trip_members (trip_id, user_id, role)
  values (new.id, new.created_by, 'organizer');
  return new;
end;
$$;
create trigger on_trip_created
  after insert on public.trips
  for each row execute function public.handle_new_trip();

-- Uma viagem nunca pode ficar sem organizador.
create or replace function public.keep_one_organizer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  remaining integer;
begin
  if (tg_op = 'DELETE' and old.role = 'organizer')
     or (tg_op = 'UPDATE' and old.role = 'organizer' and new.role <> 'organizer') then
    -- Excluir a viagem inteira apaga membros em cascata: isso é permitido.
    if not exists (select 1 from public.trips t where t.id = old.trip_id) then
      return coalesce(new, old);
    end if;
    select count(*) into remaining
      from public.trip_members m
     where m.trip_id = old.trip_id and m.role = 'organizer' and m.user_id <> old.user_id;
    if remaining = 0 then
      raise exception 'A viagem precisa de pelo menos um organizador'
        using errcode = 'P0001';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
create trigger trip_members_keep_organizer
  before update or delete on public.trip_members
  for each row execute function public.keep_one_organizer();

create table public.trip_invites (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  token_hash text not null unique,
  role public.member_role not null check (role <> 'organizer'),
  created_by uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  max_uses integer not null default 10 check (max_uses between 1 and 100),
  uses integer not null default 0 check (uses >= 0),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index trip_invites_trip_idx on public.trip_invites (trip_id);

-- ───────────────────────── Roteiro ─────────────────────────
create table public.stops (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  position integer not null default 0,
  name text not null check (char_length(name) between 1 and 80),
  country text check (char_length(country) <= 60),
  arrival_date date not null,
  departure_date date not null,
  tz text check (char_length(tz) <= 64),
  altitude_m integer check (altitude_m between -500 and 9000),
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  arrival_mode public.transport_mode,
  color text check (color ~ '^#[0-9A-Fa-f]{6}$'),
  notes text check (char_length(notes) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique (id, trip_id),
  check (departure_date >= arrival_date),
  check ((lat is null) = (lng is null))
);
create index stops_trip_idx on public.stops (trip_id, position);
create trigger stops_version before update on public.stops
  for each row execute function public.bump_version();

-- Trecho de transporte que chega a uma parada. Horários são locais de cada ponta.
create table public.transports (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  stop_id uuid not null,
  mode public.transport_mode not null default 'bus',
  origin_code text check (char_length(origin_code) <= 8),
  origin_name text check (char_length(origin_name) <= 80),
  dest_code text check (char_length(dest_code) <= 8),
  dest_name text check (char_length(dest_name) <= 80),
  depart_date date,
  depart_time time,
  depart_tz text check (char_length(depart_tz) <= 64),
  arrive_date date,
  arrive_time time,
  arrive_tz text check (char_length(arrive_tz) <= 64),
  booking_ref text check (char_length(booking_ref) <= 40),
  seat text check (char_length(seat) <= 40),
  notes text check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  foreign key (stop_id, trip_id) references public.stops (id, trip_id) on delete cascade
);
create index transports_stop_idx on public.transports (trip_id, stop_id);
create trigger transports_version before update on public.transports
  for each row execute function public.bump_version();

create table public.stays (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  stop_id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  address text check (char_length(address) <= 200),
  checkin_date date,
  checkin_time time,
  checkout_date date,
  checkout_time time,
  status public.stay_status not null default 'pending',
  notes text check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  foreign key (stop_id, trip_id) references public.stops (id, trip_id) on delete cascade
);
create index stays_stop_idx on public.stays (trip_id, stop_id);
create trigger stays_version before update on public.stays
  for each row execute function public.bump_version();

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  stop_id uuid not null,
  day date not null,
  time time,
  title text not null check (char_length(title) between 1 and 160),
  notes text check (char_length(notes) <= 2000),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  foreign key (stop_id, trip_id) references public.stops (id, trip_id) on delete cascade
);
create index activities_stop_idx on public.activities (trip_id, stop_id, day, position);
create trigger activities_version before update on public.activities
  for each row execute function public.bump_version();

-- ───────────────────────── Documentos ─────────────────────────
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  category public.doc_category not null default 'outro',
  visibility public.doc_visibility not null default 'private',
  stop_id uuid,
  storage_path text not null unique check (char_length(storage_path) <= 400),
  preview_path text unique check (char_length(preview_path) <= 400),
  original_name text not null check (char_length(original_name) <= 200),
  mime text not null check (mime in ('application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 26214400),
  valid_from date,
  valid_until date,
  notes text check (char_length(notes) <= 2000),
  status public.doc_status not null default 'uploading',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  foreign key (stop_id, trip_id) references public.stops (id, trip_id) on delete set null (stop_id),
  check (valid_until is null or valid_from is null or valid_until >= valid_from)
);
create index documents_trip_idx on public.documents (trip_id, category);
create index documents_owner_idx on public.documents (owner_id);
create trigger documents_version before update on public.documents
  for each row execute function public.bump_version();

-- Só o dono muda dono, visibilidade e caminhos do arquivo.
create or replace function public.protect_document_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_id <> old.owner_id or new.trip_id <> old.trip_id
     or new.storage_path <> old.storage_path then
    raise exception 'Campos imutáveis do documento' using errcode = '42501';
  end if;
  if (new.visibility <> old.visibility or new.preview_path is distinct from old.preview_path
      or new.status <> old.status)
     and old.owner_id <> auth.uid() then
    raise exception 'Só o dono altera visibilidade e arquivo' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger documents_protect before update on public.documents
  for each row execute function public.protect_document_fields();

create table public.document_shares (
  document_id uuid not null references public.documents (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (document_id, user_id)
);
create index document_shares_user_idx on public.document_shares (user_id);

-- ───────────────────────── Mala e pendências ─────────────────────────
create table public.packing_categories (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique (id, trip_id)
);
create index packing_categories_trip_idx on public.packing_categories (trip_id, position);
create trigger packing_categories_version before update on public.packing_categories
  for each row execute function public.bump_version();

create table public.packing_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  category_id uuid not null,
  label text not null check (char_length(label) between 1 and 120),
  done boolean not null default false,
  done_by uuid references auth.users (id) on delete set null,
  suggestion_reason text check (char_length(suggestion_reason) <= 300),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  foreign key (category_id, trip_id) references public.packing_categories (id, trip_id) on delete cascade
);
create index packing_items_trip_idx on public.packing_items (trip_id, category_id, position);
create trigger packing_items_version before update on public.packing_items
  for each row execute function public.bump_version();

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  assignee_id uuid references auth.users (id) on delete set null,
  due_date date,
  status public.task_status not null default 'todo',
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);
create index tasks_trip_idx on public.tasks (trip_id, status, due_date);
create trigger tasks_version before update on public.tasks
  for each row execute function public.bump_version();

-- ───────────────────────── Gastos ─────────────────────────
create table public.budget_categories (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  color text not null default '#FF5A1F' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  planned numeric(14, 2) not null default 0 check (planned >= 0),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique (id, trip_id)
);
create index budget_categories_trip_idx on public.budget_categories (trip_id, position);
create trigger budget_categories_version before update on public.budget_categories
  for each row execute function public.bump_version();

-- Valores em "amount/currency" são os originais; "base_amount" é a conversão para a
-- moeda da viagem com a taxa registrada no momento (não muda com cotações futuras).
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  description text not null check (char_length(description) between 1 and 120),
  category_id uuid,
  stop_id uuid,
  payer_id uuid not null references auth.users (id) on delete restrict,
  amount numeric(14, 2) not null check (amount > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  rate_to_base numeric(18, 8) not null check (rate_to_base > 0),
  rate_source text not null check (char_length(rate_source) <= 120),
  rate_date date not null,
  rate_is_manual boolean not null default false,
  base_amount numeric(14, 2) not null check (base_amount > 0),
  spent_on date not null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique (id, trip_id),
  foreign key (category_id, trip_id) references public.budget_categories (id, trip_id) on delete set null (category_id),
  foreign key (stop_id, trip_id) references public.stops (id, trip_id) on delete set null (stop_id)
);
create index expenses_trip_idx on public.expenses (trip_id, spent_on);
create trigger expenses_version before update on public.expenses
  for each row execute function public.bump_version();

-- Parte de cada participante, em centavos da moeda base (soma = base_amount).
create table public.expense_shares (
  expense_id uuid not null,
  trip_id uuid not null,
  user_id uuid not null references auth.users (id) on delete restrict,
  share_cents bigint not null check (share_cents >= 0),
  primary key (expense_id, user_id),
  foreign key (expense_id, trip_id) references public.expenses (id, trip_id) on delete cascade
);
create index expense_shares_trip_idx on public.expense_shares (trip_id);

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  from_user uuid not null references auth.users (id) on delete restrict,
  to_user uuid not null references auth.users (id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  paid_on date not null default current_date,
  note text check (char_length(note) <= 200),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (from_user <> to_user)
);
create index settlements_trip_idx on public.settlements (trip_id);

-- Pagador, rateio e acertos só podem envolver membros da viagem.
create or replace function public.require_trip_member(p_trip uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.trip_members m where m.trip_id = p_trip and m.user_id = p_user) then
    raise exception 'Pessoa não participa desta viagem' using errcode = '23514';
  end if;
end;
$$;

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
  elsif tg_table_name = 'tasks' and new.assignee_id is not null then
    perform public.require_trip_member(new.trip_id, new.assignee_id);
  end if;
  return new;
end;
$$;
create trigger expenses_people before insert or update on public.expenses
  for each row execute function public.check_expense_people();
create trigger expense_shares_people before insert or update on public.expense_shares
  for each row execute function public.check_expense_people();
create trigger settlements_people before insert or update on public.settlements
  for each row execute function public.check_expense_people();
create trigger tasks_people before insert or update on public.tasks
  for each row execute function public.check_expense_people();

-- ───────────────────────── Diário ─────────────────────────
create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  stop_id uuid,
  author_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  phase public.journal_phase not null default 'durante',
  entry_date date,
  title text check (char_length(title) <= 120),
  body text check (char_length(body) <= 10000),
  link_url text check (char_length(link_url) <= 500 and (link_url is null or link_url ~ '^https?://')),
  favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique (id, trip_id),
  foreign key (stop_id, trip_id) references public.stops (id, trip_id) on delete set null (stop_id)
);
create index journal_entries_trip_idx on public.journal_entries (trip_id, stop_id, entry_date);
create trigger journal_entries_version before update on public.journal_entries
  for each row execute function public.bump_version();

create table public.journal_photos (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null,
  entry_id uuid not null,
  storage_path text not null unique check (char_length(storage_path) <= 400),
  width integer check (width > 0),
  height integer check (height > 0),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  caption text check (char_length(caption) <= 200),
  position integer not null default 0,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  foreign key (entry_id, trip_id) references public.journal_entries (id, trip_id) on delete cascade
);
create index journal_photos_entry_idx on public.journal_photos (trip_id, entry_id, position);
