'use client';
// TEMPORÁRIO (Fase 2): o acerto de contas atual (Debts) na rota nova. Fase 6: planning §6.4.
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { useBundle } from '../data/TripContext';
import { CYCLE } from '../lib/identity/accent';
import { Debts } from './Mala';

export default function Acerto() {
  const { base } = useBundle();
  return (
    <div className="wrap">
      <ScreenHeader back={`${base}/dinheiro`} title="Acerto de contas" subtitle="Saldo de cada pessoa, com o caixa da turma como participante." />
      <Debts cols={CYCLE} />
    </div>
  );
}
