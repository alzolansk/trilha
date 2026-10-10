-- Trilha · votação da turma (ref/SPEC-votacao.md).
-- Termômetro nas inspirações do Diário, "levar pro roteiro" e enquetes (hospedagem, passeio, livre).
-- Votar/reagir é a única escrita que o leitor (viewer) pode fazer. Nada decide sozinho: nem prazo, nem IA.

-- ───────────────────────── Termômetro ─────────────────────────
-- Reação de cada pessoa a uma inspiração do Diário.
-- value: 2 = quero muito · 1 = topo · -1 = passo
create table public.inspiration_votes (
  entry_id uuid not null,
  trip_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  value smallint not null check (value in (-1, 1, 2)),
  updated_at timestamptz not null default now(),
  primary key (entry_id, user_id),
  foreign key (entry_id, trip_id) references public.journal_entries (id, trip_id) on delete cascade
);
create index inspiration_votes_trip_idx on public.inspiration_votes (trip_id);

-- Só inspirações recebem reação, e só de quem é da viagem. Entrada, viagem e pessoa não mudam.
create or replace function public.check_inspiration_vote()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.entry_id <> old.entry_id or new.trip_id <> old.trip_id or new.user_id <> old.user_id) then
    raise exception 'A reação não muda de inspiração nem de pessoa' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.journal_entries e
     where e.id = new.entry_id and e.trip_id = new.trip_id and e.kind = 'inspiracao'
  ) then
    raise exception 'Só dá pra reagir a inspirações' using errcode = '22023';
  end if;
  perform public.require_trip_member(new.trip_id, new.user_id);
  new.updated_at := now();
  return new;
end;
$$;
create trigger inspiration_votes_check before insert or update on public.inspiration_votes
  for each row execute function public.check_inspiration_vote();

-- ───────────────────────── Enquetes ─────────────────────────
create table public.polls (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  question text not null check (char_length(question) between 1 and 140),
  detail text check (char_length(detail) <= 300),
  -- stay: vencedora vira hospedagem da parada · activity: vira atividade · free: só registra
  target text not null default 'free' check (target in ('stay', 'activity', 'free')),
  stop_id uuid,
  multi boolean not null default false,          -- true: cada pessoa marca várias opções
  closes_at timestamptz,                         -- prazo para votar (opcional; não fecha sozinha)
  status text not null default 'open' check (status in ('open', 'closed')),
  decided_option_id uuid,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique (id, trip_id),
  foreign key (stop_id, trip_id) references public.stops (id, trip_id) on delete set null (stop_id),
  -- Enquete aberta de hospedagem/passeio precisa de parada: excluir a parada é recusado enquanto ela estiver aberta.
  constraint polls_stop_required check (target = 'free' or stop_id is not null or status = 'closed'),
  constraint polls_decided_when_closed check ((status = 'closed') = (decided_at is not null))
);
create index polls_trip_idx on public.polls (trip_id, status);
create trigger polls_version before update on public.polls
  for each row execute function public.bump_version();

create table public.poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null,
  trip_id uuid not null,
  label text not null check (char_length(label) between 1 and 80),
  detail text check (char_length(detail) <= 300),
  link_url text check (char_length(link_url) <= 500 and (link_url is null or link_url ~ '^https?://')),
  price numeric(14, 2) check (price is null or price >= 0),
  currency char(3) check (currency is null or currency ~ '^[A-Z]{3}$'),
  address text check (char_length(address) <= 200),   -- usado quando target = 'stay'
  position integer not null default 0,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (id, poll_id),
  unique (id, trip_id),
  foreign key (poll_id, trip_id) references public.polls (id, trip_id) on delete cascade,
  check ((price is null) = (currency is null))
);
create index poll_options_poll_idx on public.poll_options (poll_id, position);

alter table public.polls add constraint polls_decided_option_fk
  foreign key (decided_option_id, id) references public.poll_options (id, poll_id) on delete set null (decided_option_id);

create table public.poll_votes (
  poll_id uuid not null,
  option_id uuid not null,
  trip_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (option_id, user_id),
  foreign key (option_id, poll_id) references public.poll_options (id, poll_id) on delete cascade,
  foreign key (poll_id, trip_id) references public.polls (id, trip_id) on delete cascade
);
create index poll_votes_poll_idx on public.poll_votes (poll_id);
create index poll_votes_trip_idx on public.poll_votes (trip_id);

-- Opções: enquete encerrada não muda; opção com voto não muda de rótulo nem sai; no máximo 6.
-- security definer: as contagens não podem depender do que o RLS deixa a pessoa ver.
create or replace function public.check_poll_option()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if tg_op = 'DELETE' then
    select p.status into v_status from public.polls p where p.id = old.poll_id;
    if not found then
      return old; -- a enquete inteira está sendo apagada (cascata)
    end if;
    if v_status = 'closed' then
      raise exception 'Enquete encerrada' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.poll_votes v where v.option_id = old.id) then
      raise exception 'Esta opção já tem votos' using errcode = 'P0001';
    end if;
    return old;
  end if;

  select p.status into v_status from public.polls p where p.id = new.poll_id and p.trip_id = new.trip_id;
  if v_status = 'closed' then
    raise exception 'Enquete encerrada' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' then
    if new.poll_id <> old.poll_id or new.trip_id <> old.trip_id then
      raise exception 'A opção não muda de enquete' using errcode = '22023';
    end if;
    if new.label is distinct from old.label and exists (select 1 from public.poll_votes v where v.option_id = old.id) then
      raise exception 'Esta opção já tem votos' using errcode = 'P0001';
    end if;
  elsif (select count(*) from public.poll_options o where o.poll_id = new.poll_id) >= 6 then
    raise exception 'No máximo 6 opções por enquete' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger poll_options_check before insert or update or delete on public.poll_options
  for each row execute function public.check_poll_option();

-- status e decided_* só mudam em close_poll (privilégio de coluna, ver RLS).
-- Tipo de votação (multi) e alvo não mudam depois do primeiro voto.
create or replace function public.protect_poll()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.multi <> old.multi or new.target <> old.target)
     and exists (select 1 from public.poll_votes v where v.poll_id = old.id) then
    raise exception 'Não dá pra mudar o tipo da votação depois do primeiro voto' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger polls_protect before update on public.polls
  for each row execute function public.protect_poll();

-- ───────────────────────── Rastreabilidade ─────────────────────────
-- De onde veio a atividade/hospedagem: inspiração levada ao roteiro (uma atividade por
-- inspiração) ou decisão de enquete.
alter table public.activities
  add column if not exists from_entry_id uuid,
  add column if not exists from_poll_id uuid references public.polls (id) on delete set null;
alter table public.activities add constraint activities_from_entry_fk
  foreign key (from_entry_id, trip_id) references public.journal_entries (id, trip_id) on delete set null (from_entry_id);
create unique index activities_from_entry_uniq on public.activities (from_entry_id) where from_entry_id is not null;

alter table public.stays
  add column if not exists from_poll_id uuid references public.polls (id) on delete set null;

-- Preferência de lembretes de votação (rotina diária).
alter table public.notification_prefs
  add column if not exists poll_reminders boolean not null default true;

-- ───────────────────────── Saída da viagem ─────────────────────────
-- Quem sai (ou é removido) leva junto os próprios votos e reações.
-- Enquetes criadas pela pessoa continuam (o organizador decide).
create or replace function public.drop_member_votes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.inspiration_votes v where v.trip_id = old.trip_id and v.user_id = old.user_id;
  delete from public.poll_votes v where v.trip_id = old.trip_id and v.user_id = old.user_id;
  return old;
end;
$$;
create trigger trip_members_drop_votes after delete on public.trip_members
  for each row execute function public.drop_member_votes();

-- ───────────────────────── Levar inspiração ao roteiro ─────────────────────────
-- security invoker: a política de activities já exige organizador/editor; os checks abaixo
-- só deixam a mensagem humana. A parada só é gravada na inspiração quando quem promove é o
-- autor (journal_update continua valendo: ninguém edita a entrada de outra pessoa).
create or replace function public.promote_inspiration(p_entry uuid, p_stop uuid, p_day date, p_time time default null)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_entry public.journal_entries%rowtype;
  v_stop public.stops%rowtype;
  v_id uuid;
begin
  select * into v_entry from public.journal_entries e where e.id = p_entry;
  if not found then
    raise exception 'Inspiração não encontrada' using errcode = 'P0002';
  end if;
  if not public.can_edit_trip(v_entry.trip_id) then
    raise exception 'Só organizador e editores levam inspirações para o roteiro' using errcode = '42501';
  end if;
  if v_entry.kind <> 'inspiracao' then
    raise exception 'Só inspirações vão para o roteiro' using errcode = '22023';
  end if;
  if exists (select 1 from public.activities a where a.from_entry_id = p_entry) then
    raise exception 'Esta inspiração já está no roteiro' using errcode = '23505';
  end if;
  select * into v_stop from public.stops s where s.id = p_stop and s.trip_id = v_entry.trip_id;
  if not found then
    raise exception 'Parada não encontrada nesta viagem' using errcode = '22023';
  end if;
  if p_day is null or p_day < v_stop.arrival_date or p_day > v_stop.departure_date then
    raise exception 'Escolha um dia entre a chegada e a saída de %', v_stop.name using errcode = '22023';
  end if;

  insert into public.activities (trip_id, stop_id, day, time, title, notes, position, suggested_by, from_entry_id)
  values (
    v_entry.trip_id, p_stop, p_day, p_time,
    left(coalesce(nullif(trim(v_entry.title), ''), nullif(trim(v_entry.place_name), ''), 'Inspiração'), 160),
    left(nullif(concat_ws(E'\n\n', nullif(trim(v_entry.body), ''), v_entry.link_url), ''), 2000),
    (select coalesce(max(a.position) + 1, 0) from public.activities a
      where a.trip_id = v_entry.trip_id and a.stop_id = p_stop and a.day = p_day),
    null, p_entry
  )
  returning id into v_id;

  if v_entry.stop_id is null then
    update public.journal_entries set stop_id = p_stop where id = p_entry and stop_id is null;
  end if;
  return v_id;
end;
$$;

-- ───────────────────────── Votar e decidir ─────────────────────────
-- Substitui o voto da pessoa na enquete. Array vazio = retirar voto.
create or replace function public.cast_vote(p_poll uuid, p_options uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_poll public.polls%rowtype;
  v_opts uuid[];
  v_total integer;
begin
  select * into v_poll from public.polls p where p.id = p_poll for share;
  if v_uid is null or v_poll.id is null
     or not exists (select 1 from public.trip_members m where m.trip_id = v_poll.trip_id and m.user_id = v_uid) then
    raise exception 'Você não participa desta viagem' using errcode = '42501';
  end if;
  if v_poll.status <> 'open' or (v_poll.closes_at is not null and v_poll.closes_at <= now()) then
    raise exception 'Votação encerrada' using errcode = 'P0001';
  end if;
  select coalesce(array_agg(distinct o), '{}') into v_opts from unnest(coalesce(p_options, '{}'::uuid[])) o;
  if exists (
    select 1 from unnest(v_opts) o
     where not exists (select 1 from public.poll_options po where po.id = o and po.poll_id = p_poll)
  ) then
    raise exception 'Opção não pertence a esta enquete' using errcode = '22023';
  end if;
  select count(*) into v_total from public.poll_options po where po.poll_id = p_poll;
  if not v_poll.multi and cardinality(v_opts) > 1 then
    raise exception 'Nesta votação cada pessoa marca uma opção' using errcode = '22023';
  end if;
  if cardinality(v_opts) > v_total then
    raise exception 'Opções demais para esta enquete' using errcode = '22023';
  end if;

  delete from public.poll_votes v where v.poll_id = p_poll and v.user_id = v_uid;
  insert into public.poll_votes (poll_id, option_id, trip_id, user_id)
  select p_poll, o, v_poll.trip_id, v_uid from unnest(v_opts) o;
end;
$$;

-- Encerra a enquete com a opção escolhida e, se pedido, aplica no roteiro.
-- security definer: os checks de papel vêm antes de qualquer escrita.
create or replace function public.close_poll(p_poll uuid, p_option uuid, p_day date default null, p_apply boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_poll public.polls%rowtype;
  v_opt public.poll_options%rowtype;
  v_stop public.stops%rowtype;
  v_day date;
  v_stay_id uuid;
  v_id uuid;
  v_notes text;
begin
  select * into v_poll from public.polls p where p.id = p_poll for update;
  if v_uid is null or v_poll.id is null or not exists (
    select 1 from public.trip_members m
     where m.trip_id = v_poll.trip_id and m.user_id = v_uid
       and (m.role = 'organizer' or v_poll.created_by = v_uid)
  ) then
    raise exception 'Só quem criou a enquete ou o organizador decide' using errcode = '42501';
  end if;
  if v_poll.status <> 'open' then
    raise exception 'Enquete já encerrada' using errcode = 'P0001';
  end if;
  select * into v_opt from public.poll_options o where o.id = p_option and o.poll_id = p_poll;
  if not found then
    raise exception 'Opção não pertence a esta enquete' using errcode = '22023';
  end if;
  if v_poll.target <> 'free' and v_poll.stop_id is not null then
    select * into v_stop from public.stops s where s.id = v_poll.stop_id;
  end if;
  v_day := coalesce(p_day, v_stop.arrival_date);
  if p_apply and v_poll.target = 'activity' and v_stop.id is not null
     and (v_day < v_stop.arrival_date or v_day > v_stop.departure_date) then
    raise exception 'Escolha um dia entre a chegada e a saída de %', v_stop.name using errcode = '22023';
  end if;

  update public.polls
     set status = 'closed', decided_option_id = p_option, decided_by = v_uid, decided_at = now()
   where id = p_poll;

  if not p_apply then
    return jsonb_build_object('applied', false, 'reason', 'not_applied');
  end if;
  if v_poll.target = 'free' then
    return jsonb_build_object('applied', false, 'reason', 'free');
  end if;
  if v_stop.id is null then
    return jsonb_build_object('applied', false, 'reason', 'no_stop');
  end if;
  v_notes := left(nullif(concat_ws(E'\n\n', nullif(trim(v_opt.detail), ''), v_opt.link_url), ''), 2000);

  if v_poll.target = 'stay' then
    if exists (select 1 from public.stays st where st.stop_id = v_stop.id and st.status = 'booked') then
      return jsonb_build_object('applied', false, 'reason', 'stay_booked', 'stay_id', null);
    end if;
    select st.id into v_stay_id from public.stays st
     where st.stop_id = v_stop.id and st.status = 'pending'
     order by st.created_at
     limit 1
     for update;
    if v_stay_id is not null then
      update public.stays
         set name = left(v_opt.label, 120), address = v_opt.address, notes = v_notes, from_poll_id = p_poll
       where id = v_stay_id;
    else
      insert into public.stays (trip_id, stop_id, name, address, checkin_date, checkout_date, status, notes, from_poll_id)
      values (v_poll.trip_id, v_stop.id, left(v_opt.label, 120), v_opt.address, v_stop.arrival_date, v_stop.departure_date,
              'pending', v_notes, p_poll)
      returning id into v_stay_id;
    end if;
    return jsonb_build_object('applied', true, 'reason', null, 'stay_id', v_stay_id);
  end if;

  -- target = 'activity'
  insert into public.activities (trip_id, stop_id, day, title, notes, position, suggested_by, from_poll_id)
  values (
    v_poll.trip_id, v_stop.id, v_day, left(v_opt.label, 160), v_notes,
    (select coalesce(max(a.position) + 1, 0) from public.activities a where a.stop_id = v_stop.id and a.day = v_day),
    null, p_poll
  )
  returning id into v_id;
  return jsonb_build_object('applied', true, 'reason', null, 'activity_id', v_id);
end;
$$;

-- ───────────────────────── RLS ─────────────────────────
-- Termômetro: todo membro (inclusive leitor) reage; cada pessoa só mexe na própria reação.
alter table public.inspiration_votes enable row level security;
revoke all on public.inspiration_votes from anon;
grant select, insert, update, delete on public.inspiration_votes to authenticated;

create policy inspiration_votes_select on public.inspiration_votes for select to authenticated
  using (public.is_trip_member(trip_id));
create policy inspiration_votes_insert on public.inspiration_votes for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_trip_member(trip_id));
create policy inspiration_votes_update on public.inspiration_votes for update to authenticated
  using (user_id = (select auth.uid()) and public.is_trip_member(trip_id))
  with check (user_id = (select auth.uid()) and public.is_trip_member(trip_id));
create policy inspiration_votes_delete on public.inspiration_votes for delete to authenticated
  using (user_id = (select auth.uid()));

-- Enquetes: membros leem; organizador e editores criam; quem criou ou o organizador edita
-- (só enquanto aberta) e exclui. status e decided_* não têm privilégio de coluna: só close_poll muda.
alter table public.polls enable row level security;
revoke all on public.polls from anon, authenticated;
grant select, delete on public.polls to authenticated;
grant insert (id, trip_id, question, detail, target, stop_id, multi, closes_at, created_by) on public.polls to authenticated;
grant update (question, detail, closes_at, multi, version, updated_at) on public.polls to authenticated;

create policy polls_select on public.polls for select to authenticated
  using (public.is_trip_member(trip_id));
create policy polls_insert on public.polls for insert to authenticated
  with check (public.can_edit_trip(trip_id) and created_by = (select auth.uid()));
create policy polls_update on public.polls for update to authenticated
  using (status = 'open' and (created_by = (select auth.uid()) or public.is_trip_organizer(trip_id)))
  with check (status = 'open' and (created_by = (select auth.uid()) or public.is_trip_organizer(trip_id)));
create policy polls_delete on public.polls for delete to authenticated
  using (created_by = (select auth.uid()) or public.is_trip_organizer(trip_id));

-- Opções são imutáveis: para corrigir, apague e crie (se ainda não têm voto).
alter table public.poll_options enable row level security;
revoke all on public.poll_options from anon, authenticated;
grant select, delete on public.poll_options to authenticated;
grant insert (id, poll_id, trip_id, label, detail, link_url, price, currency, address, position, created_by)
  on public.poll_options to authenticated;

create policy poll_options_select on public.poll_options for select to authenticated
  using (public.is_trip_member(trip_id));
create policy poll_options_insert on public.poll_options for insert to authenticated
  with check (public.can_edit_trip(trip_id) and created_by = (select auth.uid()));
create policy poll_options_delete on public.poll_options for delete to authenticated
  using (public.can_edit_trip(trip_id));

-- Votos: todos da viagem veem (não há voto secreto); gravar só via cast_vote.
alter table public.poll_votes enable row level security;
revoke all on public.poll_votes from anon, authenticated;
grant select on public.poll_votes to authenticated;

create policy poll_votes_select on public.poll_votes for select to authenticated
  using (public.is_trip_member(trip_id));

-- ───────────────────────── Funções ─────────────────────────
-- Funções de gatilho não são chamadas pela API (/rest/v1/rpc).
revoke execute on function public.check_inspiration_vote(), public.drop_member_votes(),
  public.check_poll_option(), public.protect_poll()
  from public, anon, authenticated;
revoke execute on function public.promote_inspiration(uuid, uuid, date, time),
  public.cast_vote(uuid, uuid[]), public.close_poll(uuid, uuid, date, boolean)
  from public, anon;
grant execute on function public.promote_inspiration(uuid, uuid, date, time),
  public.cast_vote(uuid, uuid[]), public.close_poll(uuid, uuid, date, boolean)
  to authenticated;

-- ───────────────────────── Realtime ─────────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.inspiration_votes, public.polls, public.poll_options, public.poll_votes;
  end if;
end;
$$;
