-- Trilha · controle de acesso
-- Row Level Security em todas as tabelas, RPCs de convite e políticas do Storage.
-- Esconder botões no app é só conveniência: as regras valem aqui no banco.

-- ───────────────────────── Funções auxiliares ─────────────────────────
-- security definer evita recursão de RLS ao consultar trip_members dentro das políticas.
create or replace function public.trip_role(p_trip uuid)
returns public.member_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role from public.trip_members m
   where m.trip_id = p_trip and m.user_id = (select auth.uid());
$$;

create or replace function public.is_trip_member(p_trip uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.trip_members m
     where m.trip_id = p_trip and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.can_edit_trip(p_trip uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.trip_members m
     where m.trip_id = p_trip and m.user_id = (select auth.uid())
       and m.role in ('organizer', 'editor')
  );
$$;

create or replace function public.is_trip_organizer(p_trip uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.trip_members m
     where m.trip_id = p_trip and m.user_id = (select auth.uid())
       and m.role = 'organizer'
  );
$$;

create or replace function public.shares_trip_with(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.trip_members a
      join public.trip_members b on b.trip_id = a.trip_id
     where a.user_id = (select auth.uid()) and b.user_id = p_user
  );
$$;

-- Documento legível: dono; ou visível para a viagem; ou compartilhado comigo.
-- Em todos os casos a pessoa precisa continuar sendo membro da viagem.
create or replace function public.can_read_document(p_doc uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.documents d
     where d.id = p_doc
       and (
         d.owner_id = (select auth.uid())
         or (
           d.status = 'ready'
           and public.is_trip_member(d.trip_id)
           and (
             d.visibility = 'trip'
             or (d.visibility = 'shared' and exists (
               select 1 from public.document_shares s
                where s.document_id = d.id and s.user_id = (select auth.uid())
             ))
           )
         )
       )
  );
$$;

create or replace function public.owns_document(p_doc uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.documents d
     where d.id = p_doc and d.owner_id = (select auth.uid())
  );
$$;

create or replace function public.document_shared_with_me(p_doc uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.document_shares s
     where s.document_id = p_doc and s.user_id = (select auth.uid())
  );
$$;

create or replace function public.document_trip_has_member(p_doc uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.documents d
      join public.trip_members m on m.trip_id = d.trip_id and m.user_id = p_user
     where d.id = p_doc
  );
$$;

-- ───────────────────────── Permissões base ─────────────────────────
revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.trip_role(uuid), public.is_trip_member(uuid), public.can_edit_trip(uuid),
  public.is_trip_organizer(uuid), public.shares_trip_with(uuid),
  public.can_read_document(uuid), public.owns_document(uuid),
  public.document_shared_with_me(uuid), public.document_trip_has_member(uuid, uuid)
  to authenticated;

-- ───────────────────────── RLS ─────────────────────────
alter table public.profiles enable row level security;
alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.trip_invites enable row level security;
alter table public.stops enable row level security;
alter table public.transports enable row level security;
alter table public.stays enable row level security;
alter table public.activities enable row level security;
alter table public.documents enable row level security;
alter table public.document_shares enable row level security;
alter table public.packing_categories enable row level security;
alter table public.packing_items enable row level security;
alter table public.tasks enable row level security;
alter table public.budget_categories enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_shares enable row level security;
alter table public.settlements enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_photos enable row level security;

-- Perfis: vejo o meu e o de quem viaja comigo; edito só o meu.
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.shares_trip_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Viagens
-- Obs.: a filiação do organizador é criada por gatilho AFTER INSERT, então o app gera o id
-- da viagem no cliente e insere sem RETURNING.
create policy trips_select on public.trips for select to authenticated
  using (public.is_trip_member(id));
create policy trips_insert on public.trips for insert to authenticated
  with check (created_by = (select auth.uid()));
create policy trips_update on public.trips for update to authenticated
  using (public.can_edit_trip(id)) with check (public.can_edit_trip(id));
create policy trips_delete on public.trips for delete to authenticated
  using (public.is_trip_organizer(id));

-- Membros: entrada só por convite (RPC). Organizador muda papéis e remove; qualquer um pode sair.
create policy members_select on public.trip_members for select to authenticated
  using (public.is_trip_member(trip_id));
create policy members_update on public.trip_members for update to authenticated
  using (public.is_trip_organizer(trip_id)) with check (public.is_trip_organizer(trip_id));
create policy members_delete on public.trip_members for delete to authenticated
  using (public.is_trip_organizer(trip_id) or user_id = (select auth.uid()));

-- Convites: só organizadores veem e revogam. Criação e aceite via RPC.
create policy invites_select on public.trip_invites for select to authenticated
  using (public.is_trip_organizer(trip_id));
create policy invites_update on public.trip_invites for update to authenticated
  using (public.is_trip_organizer(trip_id)) with check (public.is_trip_organizer(trip_id));
create policy invites_delete on public.trip_invites for delete to authenticated
  using (public.is_trip_organizer(trip_id));

-- Conteúdo comum da viagem: membros leem; organizador e editores escrevem.
do $$
declare
  t text;
begin
  foreach t in array array[
    'stops', 'transports', 'stays', 'activities', 'packing_categories', 'packing_items',
    'tasks', 'budget_categories', 'expenses', 'expense_shares', 'settlements'
  ] loop
    execute format(
      'create policy %1$s_select on public.%1$I for select to authenticated using (public.is_trip_member(trip_id))', t);
    execute format(
      'create policy %1$s_insert on public.%1$I for insert to authenticated with check (public.can_edit_trip(trip_id))', t);
    execute format(
      'create policy %1$s_update on public.%1$I for update to authenticated using (public.can_edit_trip(trip_id)) with check (public.can_edit_trip(trip_id))', t);
    execute format(
      'create policy %1$s_delete on public.%1$I for delete to authenticated using (public.can_edit_trip(trip_id))', t);
  end loop;
end;
$$;

-- Documentos: privados por padrão.
-- Regra escrita sobre as colunas da própria linha (e não via can_read_document) para que
-- INSERT ... RETURNING funcione: a linha recém-inserida ainda não é visível para a função.
create policy documents_select on public.documents for select to authenticated
  using (
    owner_id = (select auth.uid())
    or (
      status = 'ready'
      and public.is_trip_member(trip_id)
      and (
        visibility = 'trip'
        or (visibility = 'shared' and public.document_shared_with_me(id))
      )
    )
  );
create policy documents_insert on public.documents for insert to authenticated
  with check (owner_id = (select auth.uid()) and public.can_edit_trip(trip_id));
-- Dono edita os seus; editores podem organizar (categoria, parada, título) os da viagem.
create policy documents_update on public.documents for update to authenticated
  using (
    (owner_id = (select auth.uid()) and public.is_trip_member(trip_id))
    or (visibility = 'trip' and public.can_edit_trip(trip_id))
  )
  with check (
    (owner_id = (select auth.uid()) and public.is_trip_member(trip_id))
    or (visibility = 'trip' and public.can_edit_trip(trip_id))
  );
create policy documents_delete on public.documents for delete to authenticated
  using (
    owner_id = (select auth.uid())
    or (visibility = 'trip' and public.is_trip_organizer(trip_id))
  );

create policy document_shares_select on public.document_shares for select to authenticated
  using (user_id = (select auth.uid()) or public.owns_document(document_id));
create policy document_shares_insert on public.document_shares for insert to authenticated
  with check (public.owns_document(document_id) and public.document_trip_has_member(document_id, user_id));
create policy document_shares_delete on public.document_shares for delete to authenticated
  using (public.owns_document(document_id));

-- Diário: membros leem; editores escrevem os próprios registros; organizador modera.
create policy journal_select on public.journal_entries for select to authenticated
  using (public.is_trip_member(trip_id));
create policy journal_insert on public.journal_entries for insert to authenticated
  with check (author_id = (select auth.uid()) and public.can_edit_trip(trip_id));
create policy journal_update on public.journal_entries for update to authenticated
  using (author_id = (select auth.uid()) and public.can_edit_trip(trip_id))
  with check (author_id = (select auth.uid()) and public.can_edit_trip(trip_id));
create policy journal_delete on public.journal_entries for delete to authenticated
  using ((author_id = (select auth.uid()) and public.can_edit_trip(trip_id)) or public.is_trip_organizer(trip_id));

create policy journal_photos_select on public.journal_photos for select to authenticated
  using (public.is_trip_member(trip_id));
create policy journal_photos_insert on public.journal_photos for insert to authenticated
  with check (
    created_by = (select auth.uid()) and public.can_edit_trip(trip_id)
    and exists (select 1 from public.journal_entries e
                 where e.id = entry_id and e.author_id = (select auth.uid()))
  );
create policy journal_photos_update on public.journal_photos for update to authenticated
  using (created_by = (select auth.uid()) and public.can_edit_trip(trip_id))
  with check (created_by = (select auth.uid()) and public.can_edit_trip(trip_id));
create policy journal_photos_delete on public.journal_photos for delete to authenticated
  using ((created_by = (select auth.uid()) and public.can_edit_trip(trip_id)) or public.is_trip_organizer(trip_id));

-- ───────────────────────── Convites (RPC) ─────────────────────────
-- O token em texto só existe na resposta desta função; o banco guarda apenas o hash.
create or replace function public.create_invite(
  p_trip uuid,
  p_role public.member_role default 'editor',
  p_hours integer default 168,
  p_max_uses integer default 10
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  if (select auth.uid()) is null or not public.is_trip_organizer(p_trip) then
    raise exception 'Só organizadores criam convites' using errcode = '42501';
  end if;
  if p_role = 'organizer' then
    raise exception 'Convites não podem criar organizadores' using errcode = '22023';
  end if;
  if p_hours < 1 or p_hours > 24 * 30 then
    raise exception 'Validade entre 1 hora e 30 dias' using errcode = '22023';
  end if;
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.trip_invites (trip_id, token_hash, role, created_by, expires_at, max_uses)
  values (
    p_trip,
    encode(sha256(convert_to(v_token, 'UTF8')), 'hex'),
    p_role,
    (select auth.uid()),
    now() + make_interval(hours => p_hours),
    p_max_uses
  );
  return v_token;
end;
$$;

-- Prévia do convite (nome da viagem) para quem ainda não é membro, sem revelar mais nada.
create or replace function public.preview_invite(p_token text)
returns table (trip_title text, role public.member_role, expires_at timestamptz, valid boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select t.title, i.role, i.expires_at,
         (i.revoked_at is null and i.expires_at > now() and i.uses < i.max_uses) as valid
    from public.trip_invites i
    join public.trips t on t.id = i.trip_id
   where i.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
     and (select auth.uid()) is not null;
$$;

create or replace function public.accept_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.trip_invites%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'Entre na sua conta para aceitar o convite' using errcode = '42501';
  end if;
  select * into v_inv from public.trip_invites
   where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
   for update;
  if not found then
    raise exception 'Convite inválido' using errcode = 'P0002';
  end if;
  if v_inv.revoked_at is not null then
    raise exception 'Convite revogado' using errcode = 'P0001';
  end if;
  if v_inv.expires_at <= now() then
    raise exception 'Convite expirado' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.trip_members m
              where m.trip_id = v_inv.trip_id and m.user_id = (select auth.uid())) then
    return v_inv.trip_id; -- já é membro: não muda papel nem gasta uso
  end if;
  if v_inv.uses >= v_inv.max_uses then
    raise exception 'Convite sem usos restantes' using errcode = 'P0001';
  end if;
  insert into public.trip_members (trip_id, user_id, role)
  values (v_inv.trip_id, (select auth.uid()), v_inv.role);
  update public.trip_invites set uses = uses + 1 where id = v_inv.id;
  return v_inv.trip_id;
end;
$$;

grant execute on function public.create_invite(uuid, public.member_role, integer, integer) to authenticated;
grant execute on function public.preview_invite(text) to authenticated;
grant execute on function public.accept_invite(text) to authenticated;

-- Gasto + rateio numa transação: evita despesa sem rateio (ou rateio que não fecha).
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
      rate_to_base, rate_source, rate_date, rate_is_manual, base_amount, spent_on)
    values (v_trip, p_expense ->> 'description', nullif(p_expense ->> 'category_id', '')::uuid,
      nullif(p_expense ->> 'stop_id', '')::uuid, (p_expense ->> 'payer_id')::uuid,
      (p_expense ->> 'amount')::numeric, p_expense ->> 'currency',
      (p_expense ->> 'rate_to_base')::numeric, p_expense ->> 'rate_source',
      (p_expense ->> 'rate_date')::date, coalesce((p_expense ->> 'rate_is_manual')::boolean, false),
      v_base, (p_expense ->> 'spent_on')::date)
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
      spent_on = (p_expense ->> 'spent_on')::date
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
grant execute on function public.save_expense(jsonb, jsonb) to authenticated;

-- ───────────────────────── Realtime ─────────────────────────
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array[
      'trips', 'trip_members', 'stops', 'transports', 'stays', 'activities', 'documents',
      'document_shares', 'packing_categories', 'packing_items', 'tasks', 'budget_categories',
      'expenses', 'expense_shares', 'settlements', 'journal_entries', 'journal_photos', 'profiles'
    ] loop
      execute format('alter publication supabase_realtime add table public.%I', t);
    end loop;
  end if;
end;
$$;

-- ───────────────────────── Storage ─────────────────────────
-- Buckets privados. Caminhos:
--   documents/{trip_id}/{document_id}/{arquivo}        (original e prévia JPEG do HEIC)
--   journal/{trip_id}/{entry_id}/{uuid}.jpg            (fotos comprimidas do diário)
--   covers/{trip_id}/{uuid}.jpg                        (capa da viagem)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('documents', 'documents', false, 26214400,
   array['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif']),
  ('journal', 'journal', false, 10485760, array['image/jpeg', 'image/webp']),
  ('covers', 'covers', false, 10485760, array['image/jpeg', 'image/webp', 'image/png'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.storage_trip_id(p_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return split_part(p_name, '/', 1)::uuid;
exception when others then
  return null;
end;
$$;
grant execute on function public.storage_trip_id(text) to authenticated;

-- Funções criadas acima herdam privilégios padrão; anon não executa nada do app.
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.trip_role(uuid), public.is_trip_member(uuid), public.can_edit_trip(uuid),
  public.is_trip_organizer(uuid), public.shares_trip_with(uuid),
  public.can_read_document(uuid), public.owns_document(uuid), public.require_trip_member(uuid, uuid),
  public.document_shared_with_me(uuid), public.document_trip_has_member(uuid, uuid),
  public.create_invite(uuid, public.member_role, integer, integer), public.preview_invite(text),
  public.accept_invite(text), public.save_expense(jsonb, jsonb), public.storage_trip_id(text)
  to authenticated;

-- documents: leitura conforme a linha de metadados; envio só para a própria linha "uploading".
create policy documents_objects_select on storage.objects for select to authenticated
  using (
    bucket_id = 'documents'
    and exists (
      select 1 from public.documents d
       where (d.storage_path = storage.objects.name or d.preview_path = storage.objects.name)
         and public.can_read_document(d.id)
    )
  );
create policy documents_objects_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documents'
    and exists (
      select 1 from public.documents d
       where (d.storage_path = storage.objects.name or d.preview_path = storage.objects.name)
         and d.owner_id = (select auth.uid())
         and d.status = 'uploading'
         and public.can_edit_trip(d.trip_id)
    )
  );
create policy documents_objects_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'documents'
    and (
      exists (
        select 1 from public.documents d
         where (d.storage_path = storage.objects.name or d.preview_path = storage.objects.name)
           and (d.owner_id = (select auth.uid())
                or (d.visibility = 'trip' and public.is_trip_organizer(d.trip_id)))
      )
      -- arquivo órfão (metadados já removidos): só quem enviou apaga
      or (
        owner_id = (select auth.uid())::text
        and not exists (
          select 1 from public.documents d
           where d.storage_path = storage.objects.name or d.preview_path = storage.objects.name
        )
      )
    )
  );

-- journal
create policy journal_objects_select on storage.objects for select to authenticated
  using (bucket_id = 'journal' and public.is_trip_member(public.storage_trip_id(name)));
create policy journal_objects_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'journal'
    and public.can_edit_trip(public.storage_trip_id(name))
    and exists (
      select 1 from public.journal_entries e
       where e.trip_id = public.storage_trip_id(storage.objects.name)
         and e.id::text = split_part(storage.objects.name, '/', 2)
         and e.author_id = (select auth.uid())
    )
  );
create policy journal_objects_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'journal'
    and (owner_id = (select auth.uid())::text or public.is_trip_organizer(public.storage_trip_id(name)))
  );

-- covers
create policy covers_objects_select on storage.objects for select to authenticated
  using (bucket_id = 'covers' and public.is_trip_member(public.storage_trip_id(name)));
create policy covers_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'covers' and public.can_edit_trip(public.storage_trip_id(name)));
create policy covers_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'covers' and public.can_edit_trip(public.storage_trip_id(name)));
