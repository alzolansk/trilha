'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Skeleton } from '../components/ui/primitives';
import { useAuth } from '../data/AuthContext';

/** "/" → trilha ativa (última aberta), ou primeira, ou onboarding. */
export default function Root() {
  const { ready, user, trips, configured } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!ready) return;
    if (!configured || !user) return router.replace('/entrar');
    if (trips === null) return;
    let last: string | null = null;
    try {
      last = localStorage.getItem('trilha.last');
    } catch {
      /* ignora */
    }
    const pick = trips.find((t) => t.trip.id === last) ?? trips[0];
    router.replace(pick ? `/t/${pick.trip.id}` : '/nova-trilha');
  }, [ready, user, trips, configured, router]);
  return (
    <div className="wrap" style={{ paddingTop: 120 }} aria-busy="true">
      <span className="sr">Carregando…</span>
      <Skeleton h={300} />
      <noscript>
        <Link href="/entrar">Entrar</Link>
      </noscript>
    </div>
  );
}
