'use client';
import type { Session, User } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { setAnalyticsOptIn } from '../lib/analytics';
import { getSupabase } from '../lib/supabase/client';
import { getTripList, saveTripList, wipeAllLocalData } from './offline';
import type { Profile, Role, Trip, TripSummary } from './types';

interface AuthState {
  configured: boolean;
  ready: boolean;
  user: User | null;
  profile: Profile | null;
  online: boolean;
  trips: TripSummary[] | null;
  tripsError: string | null;
  refreshTrips: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const sb = getSupabase();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(true);
  const [trips, setTrips] = useState<TripSummary[] | null>(null);
  const [tripsError, setTripsError] = useState<string | null>(null);

  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    if (!sb) {
      setReady(true);
      return;
    }
    let alive = true;
    // getSession lê a sessão local (funciona offline); a validação real acontece no servidor/RLS.
    sb.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      if (!alive) return;
      setUser(data.session?.user ?? null);
      setReady(true);
    });
    const { data } = sb.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, [sb]);

  const refreshProfile = useCallback(async () => {
    if (!sb || !user) return setProfile(null);
    const r = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (!r.error) {
      setProfile(r.data);
      setAnalyticsOptIn(!!r.data?.analytics_opt_in);
    }
  }, [sb, user]);

  const refreshTrips = useCallback(async () => {
    if (!sb || !user) {
      setTrips(null);
      return;
    }
    const cached = await getTripList(user.id);
    if (cached && trips === null) setTrips(cached);
    if (!navigator.onLine) return;
    const r = await sb.from('trip_members').select('role, trips(*)').eq('user_id', user.id);
    if (r.error) {
      setTripsError(r.error.message);
      return;
    }
    const stopCounts = await sb.from('stops').select('trip_id');
    const counts = new Map<string, number>();
    for (const s of (stopCounts.data ?? []) as { trip_id: string }[]) counts.set(s.trip_id, (counts.get(s.trip_id) ?? 0) + 1);
    const list: TripSummary[] = ((r.data ?? []) as unknown as { role: Role; trips: Trip | null }[])
      .filter((m) => m.trips)
      .map((m) => ({ trip: m.trips as Trip, role: m.role, stopCount: counts.get((m.trips as Trip).id) ?? 0 }))
      .sort((a, b) => a.trip.start_date.localeCompare(b.trip.start_date));
    setTrips(list);
    setTripsError(null);
    void saveTripList(user.id, list);
  }, [sb, user, trips]);

  useEffect(() => {
    void refreshProfile();
    void refreshTrips();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const signOut = useCallback(async () => {
    await wipeAllLocalData();
    if (sb) await sb.auth.signOut();
    setUser(null);
    setTrips(null);
    window.location.href = '/entrar';
  }, [sb]);

  const value = useMemo<AuthState>(
    () => ({ configured: !!sb, ready, user, profile, online, trips, tripsError, refreshTrips, refreshProfile, signOut }),
    [sb, ready, user, profile, online, trips, tripsError, refreshTrips, refreshProfile, signOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth fora do AuthProvider');
  return c;
}
