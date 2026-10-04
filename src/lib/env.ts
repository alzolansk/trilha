// Variáveis públicas (vão para o navegador). Segredos ficam em src/lib/server-env.ts.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? '';
export const AUTH_GOOGLE = process.env.NEXT_PUBLIC_AUTH_GOOGLE === '1';
export const AUTH_APPLE = process.env.NEXT_PUBLIC_AUTH_APPLE === '1';
export const AUTH_MAGIC_LINK = process.env.NEXT_PUBLIC_AUTH_MAGIC_LINK === '1';
export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';
export const isSupabaseConfigured = () => Boolean(SUPABASE_URL && SUPABASE_KEY);
