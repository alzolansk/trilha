-- Fase 6: permissões do caixa e confirmação da estadia na mesma transação do gasto.
drop policy if exists pool_contributions_insert on public.pool_contributions;
create policy pool_contributions_insert on public.pool_contributions for insert to authenticated
  with check (
    public.can_edit_trip(trip_id) and created_by = (select auth.uid())
    and (public.is_trip_organizer(trip_id) or (user_id = (select auth.uid()) and kind = 'deposit'))
  );
drop policy if exists pool_contributions_delete on public.pool_contributions;
create policy pool_contributions_delete on public.pool_contributions for delete to authenticated
  using (public.is_trip_organizer(trip_id) or (
    public.can_edit_trip(trip_id) and user_id = (select auth.uid())
    and created_by = (select auth.uid()) and kind = 'deposit'
  ));

create or replace function public.book_paid_stay()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.stay_id is not null then
    update public.stays set status = 'booked'
      where trip_id = new.trip_id and id = new.stay_id and status = 'pending';
  end if;
  return new;
end;
$$;
create trigger expenses_book_stay after insert or update of stay_id on public.expenses
  for each row execute function public.book_paid_stay();
-- Apagar o gasto não desfaz uma reserva real. O selo pago continua derivado dos vínculos.

-- Fechamento atômico: erro de versão, permissão ou categoria desfaz toda a operação.
create or replace function public.close_budget(
  p_trip uuid, p_version integer, p_plan jsonb, p_categories jsonb,
  p_transports jsonb, p_question text default null
) returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_version integer;
  v_currency text;
  r jsonb;
  v_poll uuid;
begin
  if not public.can_edit_trip(p_trip) then
    raise exception 'Só editores podem fechar o orçamento' using errcode = '42501';
  end if;
  select version, base_currency into v_version, v_currency from public.trips where id = p_trip for update;
  if v_version is distinct from p_version then
    raise exception 'A trilha mudou. Reabra o orçamento para recalcular antes de salvar.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_plan) <> 'object' or jsonb_typeof(p_categories) <> 'array' or jsonb_typeof(p_transports) <> 'array' then
    raise exception 'Orçamento inválido' using errcode = '22023';
  end if;
  for r in select * from jsonb_array_elements(p_transports) loop
    update public.transports set price_cents = (r->>'cents')::bigint, price_currency = v_currency, price_is_estimate = false
      where id = (r->>'id')::uuid and trip_id = p_trip and version = (r->>'version')::integer;
    if not found then raise exception 'Um trecho mudou. Reabra o orçamento.' using errcode = 'P0001'; end if;
  end loop;
  for r in select * from jsonb_array_elements(p_categories) loop
    if r->>'version' is null then
      insert into public.budget_categories (id, trip_id, name, kind, color, position, planned)
        values ((r->>'id')::uuid, p_trip, r->>'name', r->>'kind', r->>'color', (r->>'position')::integer, (r->>'planned')::numeric);
    else
      update public.budget_categories set planned = (r->>'planned')::numeric, kind = r->>'kind'
        where id = (r->>'id')::uuid and trip_id = p_trip and version = (r->>'version')::integer;
      if not found then raise exception 'Uma categoria mudou. Reabra o orçamento.' using errcode = 'P0001'; end if;
    end if;
  end loop;
  update public.trips set budget_plan = p_plan where id = p_trip;
  if p_question is not null and (select count(*) from public.trip_members where trip_id = p_trip) > 1
      and not exists (select 1 from public.polls where trip_id = p_trip and target = 'free' and status = 'open' and question = p_question) then
    insert into public.polls (trip_id, question, detail, target, created_by)
      values (p_trip, p_question, 'Previsão da turma. Valores com ESTIMATIVA precisam ser confirmados.', 'free', auth.uid()) returning id into v_poll;
    insert into public.poll_options (trip_id, poll_id, label, position, created_by)
      values (p_trip, v_poll, 'Sim', 0, auth.uid()), (p_trip, v_poll, 'Ajustar', 1, auth.uid());
  end if;
end;
$$;
revoke all on function public.close_budget(uuid, integer, jsonb, jsonb, jsonb, text) from public, anon;
grant execute on function public.close_budget(uuid, integer, jsonb, jsonb, jsonb, text) to authenticated;
