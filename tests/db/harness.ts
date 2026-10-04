// Executa as migrations reais num Postgres em WASM (PGlite), com stubs mínimos dos
// esquemas que o Supabase fornece (auth, storage e papéis). Serve para testar RLS e RPCs.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SUPABASE_STUBS = `
create role anon nologin;
create role authenticated nologin;
create schema auth;
create schema storage;
grant usage on schema auth, storage, public to anon, authenticated;

create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated;

create table storage.buckets (
  id text primary key, name text, public boolean,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text not null,
  owner_id text default (auth.uid())::text,
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated;
`;

export type Db = PGlite & { as<T = unknown>(uid: string | null, sql: string, params?: unknown[]): Promise<T[]> };

export async function createDb(): Promise<Db> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  const dir = join(process.cwd(), 'supabase', 'migrations');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(dir, file), 'utf8'));
  }
  const anyDb = db as Db;
  // Executa uma consulta como um usuário autenticado (ou anon), dentro de uma transação.
  anyDb.as = async <T,>(uid: string | null, sql: string, params: unknown[] = []) => {
    return db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? '']);
      await tx.exec(`set local role ${uid ? 'authenticated' : 'anon'}`);
      const res = await tx.query<T>(sql, params);
      return res.rows;
    });
  };
  return anyDb;
}

export async function createUser(db: PGlite, id: string, name: string) {
  await db.query(
    `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, jsonb_build_object('display_name', $3::text))`,
    [id, `${name.toLowerCase()}@exemplo.com`, name],
  );
}
