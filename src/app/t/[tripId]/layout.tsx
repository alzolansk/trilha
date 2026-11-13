'use client';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import { TripShell } from '../../../components/shell/TripShell';
import { PageLoader } from '../../../components/ui/Loader';
import { useAuth } from '../../../data/AuthContext';
import { createSupabaseSource } from '../../../data/supabaseSource';
import { TripProvider } from '../../../data/TripContext';
import { getSupabase } from '../../../lib/supabase/client';

export default function TripLayout({ children }: { children: React.ReactNode }) {
  const { tripId } = useParams<{ tripId: string }>();
  const { ready, user, configured } = useAuth();
  const router = useRouter();
  const path = usePathname();
  const sb = getSupabase();

  useEffect(() => {
    if (ready && (!user || !configured)) router.replace(`/entrar?next=${encodeURIComponent(path)}`);
  }, [ready, user, configured, router, path]);

  useEffect(() => {
    try {
      localStorage.setItem('trilha.last', tripId);
    } catch {
      /* ignora */
    }
  }, [tripId]);

  const source = useMemo(() => (sb && user ? createSupabaseSource(sb, tripId, user.id) : null), [sb, user, tripId]);

  if (!source) {
    return (
      <PageLoader messages={['Abrindo a trilha', 'Juntando a turma', 'Arrumando o roteiro']} />
    );
  }
  return (
    <TripProvider source={source} base={`/t/${tripId}`}>
      <TripShell>{children}</TripShell>
    </TripProvider>
  );
}
