'use client';
// TEMPORÁRIO (Fase 2): a lista de votações atual (Decisions) na rota nova /turma/votos.
// A Fase 7 redesenha (planning §5.7 e §6.6).
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { useBundle } from '../data/TripContext';
import { Decisions } from './Turma';

export default function Votos() {
  const { base } = useBundle();
  return (
    <div className="wrap">
      <ScreenHeader back={`${base}/turma`} title="Votos" subtitle="Abertas, esperando decisão e encerradas." />
      <Decisions />
    </div>
  );
}
