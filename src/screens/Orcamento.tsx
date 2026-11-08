'use client';
// TEMPORÁRIO (Fase 2): mostra o orçamento atual e o ajuste por categoria (antigo BudgetDialog).
// A Fase 6 substitui pelo Orçamento em conversa (Orcamento.dc.html, planning §5.5).
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { useBundle } from '../data/TripContext';
import { CYCLE } from '../lib/identity/accent';
import { Budget } from './Mala';

export default function Orcamento() {
  const { base } = useBundle();
  return (
    <div className="wrap">
      <ScreenHeader back={`${base}/dinheiro`} title="Orçamento" subtitle="Quanto a turma planeja gastar em cada categoria." />
      <Budget cols={CYCLE} />
    </div>
  );
}
