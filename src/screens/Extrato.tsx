'use client';
// TEMPORÁRIO (Fase 2): a lista de gastos atual (ExpenseList) na rota nova. Fase 6: planning §6.3.
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { useBundle } from '../data/TripContext';
import { ExpenseList } from './Mala';

export default function Extrato() {
  const { base } = useBundle();
  return (
    <div className="wrap">
      <ScreenHeader back={`${base}/dinheiro`} title="Extrato" subtitle="Gastos da turma, do mais recente ao mais antigo." />
      <ExpenseList />
    </div>
  );
}
