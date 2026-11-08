'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { DestinationIdentity } from '../lib/identity/types';
import { DICTIONARY } from '../lib/identity/dictionary';
import { tripAccent } from '../lib/identity/accent';
import { getBundle, getBundleSavedAt, saveBundle } from './offline';
import { humanError, type TripSource } from './source';
import type { Profile, Role, TripBundle } from './types';

interface TripState {
  source: TripSource;
  base: string; // "/t/<id>" ou "/demo/<key>"
  bundle: TripBundle | null;
  /** @deprecated identidade antiga; só as telas ainda não redesenhadas usam. Use `accent`. */
  identity: DestinationIdentity;
  /** cor de destaque da trilha (planning §1) */
  accent: string;
  loading: boolean;
  error: string | null;
  /** dados vindos da cópia local (sem conexão ou servidor indisponível) */
  stale: boolean;
  /** quando a cópia local mostrada foi salva (ISO), se `stale` */
  staleSince: string | null;
  role: Role | null;
  canEdit: boolean;
  isOrganizer: boolean;
  me: string;
  reload: () => Promise<void>;
  profileOf: (userId: string | null | undefined) => Profile | null;
}

const Ctx = createContext<TripState | null>(null);

export function TripProvider({ source, base, children, initialBundle = null }: { source: TripSource; base: string; children: React.ReactNode; initialBundle?: TripBundle | null }) {
  // initialBundle: só na demonstração (dados estáticos), permite renderizar no servidor.
  const [bundle, setBundle] = useState<TripBundle | null>(initialBundle);
  const [loading, setLoading] = useState(!initialBundle);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [staleSince, setStaleSince] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<void> | null>(null);

  const reload = useCallback(async () => {
    if (inflight.current) return inflight.current;
    const run = (async () => {
      try {
        const b = await source.load();
        setBundle(b);
        setError(null);
        setStale(false);
        if (source.kind === 'supabase') void saveBundle(source.userId, b);
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (source.kind === 'supabase' && code !== 'NOT_FOUND') {
          const cached = await getBundle(source.userId, source.tripId);
          if (cached) {
            setBundle(cached);
            setStale(true);
            setError(null);
            return;
          }
        }
        setError(code === 'NOT_FOUND' ? 'Essa trilha não existe ou você não tem acesso a ela.' : humanError(e));
      } finally {
        setLoading(false);
        inflight.current = null;
      }
    })();
    inflight.current = run;
    return run;
  }, [source]);

  useEffect(() => {
    let alive = true;
    // Mostra a cópia local na hora (abre offline) e atualiza do servidor em seguida.
    (async () => {
      if (source.kind === 'supabase') {
        const cached = await getBundle(source.userId, source.tripId);
        if (alive && cached) {
          setBundle(cached);
          setStale(true);
          setLoading(false);
        }
      }
      if (alive) await reload();
    })();
    const unsub = source.subscribe(() => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void reload(), 350);
    });
    const onOnline = () => void reload();
    window.addEventListener('online', onOnline);
    return () => {
      alive = false;
      unsub();
      window.removeEventListener('online', onOnline);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [source, reload]);

  useEffect(() => {
    if (!stale || source.kind !== 'supabase') return setStaleSince(null);
    let alive = true;
    void getBundleSavedAt(source.userId, source.tripId).then((at) => alive && setStaleSince(at));
    return () => {
      alive = false;
    };
  }, [stale, source]);

  const value = useMemo<TripState>(() => {
    const me = source.userId;
    const role = bundle?.members.find((m) => m.user_id === me)?.role ?? null;
    const identity = bundle?.trip.identity ?? DICTIONARY.andes;
    return {
      source,
      base,
      bundle,
      identity,
      accent: tripAccent(bundle?.trip),
      loading,
      error,
      stale,
      staleSince,
      role,
      canEdit: role === 'organizer' || role === 'editor',
      isOrganizer: role === 'organizer',
      me,
      reload,
      profileOf: (id) => bundle?.profiles.find((p) => p.id === id) ?? null,
    };
  }, [source, base, bundle, loading, error, stale, staleSince, reload]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTrip() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useTrip fora do TripProvider');
  return c;
}

/** Versão que garante bundle carregado (use dentro de telas já protegidas pelo Shell). */
export function useBundle(): TripState & { bundle: TripBundle } {
  const t = useTrip();
  if (!t.bundle) throw new Error('bundle ainda não carregado');
  return t as TripState & { bundle: TripBundle };
}
