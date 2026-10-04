'use client';
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isSupabaseConfigured, SUPABASE_KEY, SUPABASE_URL } from '../env';

let client: SupabaseClient | null = null;

/** Cliente do navegador (sessão em cookies, compartilhada com as rotas de servidor). */
export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (!client) client = createBrowserClient(SUPABASE_URL, SUPABASE_KEY);
  return client;
}
