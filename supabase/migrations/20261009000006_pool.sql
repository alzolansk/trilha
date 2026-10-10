-- Trilha · caixa da turma (vaquinha).
-- Cada pessoa aporta dinheiro num caixa comum; gastos podem sair do caixa em vez do bolso de alguém.
-- Valores em centavos da moeda base da viagem. No acerto de contas o caixa entra como mais
-- um participante: sobra vira devolução para quem aportou; falta vira pedido de novo aporte.

create type public.pool_entry_kind as enum ('deposit', 'refund');

create table public.pool_contributions (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  -- deposit: a pessoa colocou no caixa · refund: o caixa devolveu para a pessoa
  user_id uuid not null references auth.users (id) on delete restrict,
  kind public.pool_entry_kind not null default 'deposit',
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  contributed_on date not null default current_date,
  note text check (char_length(note) <= 200),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index pool_contributions_trip_idx on public.pool_contributions (trip_id, contributed_on);

-- Gasto pago com dinheiro do caixa: payer_id fica sendo quem registrou/usou o caixa,
-- mas não conta como dinheiro dessa pessoa no acerto.
alter table public.expenses add column if not exists paid_from_pool boolean not null default false;

-- Quem aporta precisa ser da viagem (mesma regra de gastos e pagamentos).
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
  elsif tg_table_name = 'tasks' and new.assignee_id is not null then
    perform public.require_trip_member(new.trip_id, new.assignee_id);
  end if;
  return new;
end;
$$;
create trigger pool_contributions_people before insert or update on public.pool_contributions
  for each row execute function public.check_expense_people();

-- save_expense passa a gravar paid_from_pool.
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

  if v_id is null then
    insert into public.expenses (trip_id, description, category_id, stop_id, payer_id, amount, currency,
      rate_to_base, rate_source, rate_date, rate_is_manual, base_amount, spent_on, paid_from_pool)
    values (v_trip, p_expense ->> 'description', nullif(p_expense ->> 'category_id', '')::uuid,
      nullif(p_expense ->> 'stop_id', '')::uuid, (p_expense ->> 'payer_id')::uuid,
      (p_expense ->> 'amount')::numeric, p_expense ->> 'currency',
      (p_expense ->> 'rate_to_base')::numeric, p_expense ->> 'rate_source',
      (p_expense ->> 'rate_date')::date, coalesce((p_expense ->> 'rate_is_manual')::boolean, false),
      v_base, (p_expense ->> 'spent_on')::date, v_pool)
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
      paid_from_pool = v_pool
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

-- ───────────────────────── RLS ─────────────────────────
-- Igual a gastos e pagamentos: membros leem; organizador e editores lançam e desfazem.
alter table public.pool_contributions enable row level security;
revoke all on public.pool_contributions from anon;
grant select, insert, delete on public.pool_contributions to authenticated;
revoke update on public.pool_contributions from authenticated;

create policy pool_contributions_select on public.pool_contributions for select to authenticated
  using (public.is_trip_member(trip_id));
create policy pool_contributions_insert on public.pool_contributions for insert to authenticated
  with check (public.can_edit_trip(trip_id) and created_by = (select auth.uid()));
create policy pool_contributions_delete on public.pool_contributions for delete to authenticated
  using (public.can_edit_trip(trip_id));

-- ───────────────────────── Realtime ─────────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.pool_contributions;
  end if;
end;
$$;
