'use client';
// TEMPORÁRIO (Fase 2): /roteiro/[stopId] já existe, mas a página da parada (Parada.dc.html,
// planning §5.3) chega na Fase 5. Até lá, abre o roteiro atual com a parada selecionada.
import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ScreenSkeleton } from '../components/ui/Skeleton';
import { useBundle } from '../data/TripContext';

export default function Parada() {
  const { stopId } = useParams<{ stopId: string }>();
  const { base } = useBundle();
  const router = useRouter();
  useEffect(() => {
    router.replace(`${base}/roteiro?parada=${encodeURIComponent(stopId)}`);
  }, [router, base, stopId]);
  return <ScreenSkeleton />;
}
