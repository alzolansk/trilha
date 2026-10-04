import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Renova a sessão do Supabase (cookies) a cada navegação. Autorização de verdade
// acontece no banco (RLS) e nas rotas de API — aqui é só manutenção da sessão.
export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let response = NextResponse.next({ request });
  if (!url || !key) return response;
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  try {
    await supabase.auth.getUser();
  } catch {
    /* offline ou Supabase indisponível: segue sem renovar */
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|sw.js|manifest.webmanifest|icons/|favicon.ico|.*\.(?:svg|png|jpg|webp|woff2)$).*)'],
};
