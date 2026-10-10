-- Trilha · criptografia ponta a ponta dos documentos (AES-256-GCM no navegador).
--
-- O servidor guarda só material cifrado:
--   user_keys      chave pública ECDH P-256 de cada pessoa (a turma lê para poder liberar documentos)
--   user_vaults    chave privada cifrada com a frase de segurança (PBKDF2 → AES-GCM); só a dona lê
--   document_keys  chave AES de cada documento, embrulhada para cada pessoa com acesso (ECDH efêmero + HKDF)
-- O arquivo e a prévia vão para o Storage já cifrados. Título, categoria e nome do arquivo
-- continuam em texto (busca, filtros e avisos dependem deles).

-- ───────────────────────── Chaves das pessoas ─────────────────────────
create table public.user_keys (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  public_key jsonb not null check (public_key ->> 'kty' = 'EC' and public_key ->> 'crv' = 'P-256' and not public_key ? 'd'),
  created_at timestamptz not null default now()
);

create table public.user_vaults (
  user_id uuid primary key default auth.uid() references public.user_keys (user_id) on delete cascade,
  wrapped_private_key text not null check (char_length(wrapped_private_key) <= 4000),
  wrap_iv text not null check (char_length(wrap_iv) <= 64),
  kdf_salt text not null check (char_length(kdf_salt) <= 64),
  kdf_iterations integer not null check (kdf_iterations between 100000 and 10000000),
  updated_at timestamptz not null default now()
);

-- ───────────────────────── Chaves dos documentos ─────────────────────────
alter table public.documents add column if not exists encrypted boolean not null default false;

create table public.document_keys (
  document_id uuid not null references public.documents (id) on delete cascade,
  user_id uuid not null references public.user_keys (user_id) on delete cascade,
  -- "v1.<chave pública efêmera>.<iv>.<chave AES embrulhada>" (base64url)
  wrapped_key text not null check (char_length(wrapped_key) <= 1000),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (document_id, user_id)
);
create index document_keys_user_idx on public.document_keys (user_id);

-- A pessoa p_user tem direito de ler o documento? (mesma regra de can_read_document, para outra pessoa)
-- Só responde sobre documentos que quem pergunta já lê.
create or replace function public.document_visible_to(p_doc uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_read_document(p_doc) and exists (
    select 1 from public.documents d
     where d.id = p_doc
       and (
         d.owner_id = p_user
         or (
           exists (select 1 from public.trip_members m where m.trip_id = d.trip_id and m.user_id = p_user)
           and (
             d.visibility = 'trip'
             or (d.visibility = 'shared' and exists (
               select 1 from public.document_shares s where s.document_id = d.id and s.user_id = p_user
             ))
           )
         )
       )
  );
$$;

-- Cria par de chaves + cofre de uma vez (a pessoa ainda não tem chaves).
create or replace function public.create_key_vault(
  p_public_key jsonb, p_wrapped text, p_iv text, p_salt text, p_iterations integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;
  if exists (select 1 from public.user_keys where user_id = v_uid) then
    raise exception 'Você já tem um cofre. Desbloqueie com a sua frase de segurança.' using errcode = 'P0001';
  end if;
  insert into public.user_keys (user_id, public_key) values (v_uid, p_public_key);
  insert into public.user_vaults (user_id, wrapped_private_key, wrap_iv, kdf_salt, kdf_iterations)
  values (v_uid, p_wrapped, p_iv, p_salt, p_iterations);
end;
$$;

-- Esqueceu a frase: apaga as chaves (e com elas o acesso aos documentos cifrados).
-- Documentos da turma voltam quando alguém com acesso abrir o app; privados se perdem.
create or replace function public.reset_key_vault()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;
  delete from public.user_keys where user_id = (select auth.uid());
end;
$$;

-- ───────────────────────── Revogação ─────────────────────────
-- Quem perde acesso perde também a chave embrulhada para si.
-- (Quem já baixou a chave antes pode ter guardado: revogar não substitui trocar o arquivo.)
create or replace function public.prune_document_keys()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'documents' then
    delete from public.document_keys k
     using public.documents d
     where k.document_id = new.id and d.id = new.id
       and k.user_id <> d.owner_id
       and not (
         exists (select 1 from public.trip_members m where m.trip_id = d.trip_id and m.user_id = k.user_id)
         and (d.visibility = 'trip' or (d.visibility = 'shared' and exists (
           select 1 from public.document_shares s where s.document_id = d.id and s.user_id = k.user_id)))
       );
    return new;
  elsif tg_table_name = 'document_shares' then
    delete from public.document_keys k
     using public.documents d
     where k.document_id = old.document_id and k.user_id = old.user_id
       and d.id = old.document_id and d.owner_id <> old.user_id and d.visibility <> 'trip';
    return old;
  else -- trip_members
    delete from public.document_keys k
     using public.documents d
     where k.document_id = d.id and d.trip_id = old.trip_id
       and k.user_id = old.user_id and d.owner_id <> old.user_id;
    return old;
  end if;
end;
$$;
create trigger documents_prune_keys after update of visibility on public.documents
  for each row when (new.visibility is distinct from old.visibility)
  execute function public.prune_document_keys();
create trigger document_shares_prune_keys after delete on public.document_shares
  for each row execute function public.prune_document_keys();
create trigger trip_members_prune_keys after delete on public.trip_members
  for each row execute function public.prune_document_keys();

-- Documento cifrado não volta a ser texto (e vice-versa).
create or replace function public.protect_document_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_id <> old.owner_id or new.trip_id <> old.trip_id
     or new.storage_path <> old.storage_path or new.encrypted <> old.encrypted then
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

-- ───────────────────────── RLS ─────────────────────────
alter table public.user_keys enable row level security;
alter table public.user_vaults enable row level security;
alter table public.document_keys enable row level security;

revoke all on public.user_keys, public.user_vaults, public.document_keys from anon;
grant select on public.user_keys to authenticated;
revoke insert, update, delete on public.user_keys from authenticated;
grant select, update on public.user_vaults to authenticated;
revoke insert, delete on public.user_vaults from authenticated;
grant select, insert, delete on public.document_keys to authenticated;
revoke update on public.document_keys from authenticated;

-- Chave pública: a própria e a de quem viaja junto.
create policy user_keys_select on public.user_keys for select to authenticated
  using (user_id = (select auth.uid()) or public.shares_trip_with(user_id));
-- Cofre: só a dona (troca de frase = update).
create policy user_vaults_select on public.user_vaults for select to authenticated
  using (user_id = (select auth.uid()));
create policy user_vaults_update on public.user_vaults for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Quem lê o documento vê quem já tem chave (para liberar a quem falta); embrulhos alheios são inúteis.
create policy document_keys_select on public.document_keys for select to authenticated
  using (user_id = (select auth.uid()) or public.can_read_document(document_id));
-- Libera só quem já lê o documento, e só para quem também tem direito de ler.
create policy document_keys_insert on public.document_keys for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and public.can_read_document(document_id)
    and public.document_visible_to(document_id, user_id)
  );
create policy document_keys_delete on public.document_keys for delete to authenticated
  using (user_id = (select auth.uid()) or public.owns_document(document_id));

-- Documentos novos só entram cifrados.
drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents for insert to authenticated
  with check (owner_id = (select auth.uid()) and public.can_edit_trip(trip_id) and encrypted);

-- ───────────────────────── Funções ─────────────────────────
revoke execute on function public.document_visible_to(uuid, uuid), public.create_key_vault(jsonb, text, text, text, integer),
  public.reset_key_vault(), public.prune_document_keys(), public.protect_document_fields()
  from public, anon;
revoke execute on function public.prune_document_keys(), public.protect_document_fields() from authenticated;
grant execute on function public.document_visible_to(uuid, uuid), public.create_key_vault(jsonb, text, text, text, integer),
  public.reset_key_vault()
  to authenticated;

-- ───────────────────────── Storage ─────────────────────────
-- Conteúdo cifrado é application/octet-stream; 25 MB + cabeçalho e tag do GCM.
update storage.buckets
   set allowed_mime_types = array['application/octet-stream', 'application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif'],
       file_size_limit = 26214400 + 1024
 where id = 'documents';

-- ───────────────────────── Realtime ─────────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.user_keys, public.document_keys;
  end if;
end;
$$;
