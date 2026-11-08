'use client';
// TEMPORÁRIO (Fase 2): a metade "gastos" da antiga tela Mala, na rota nova /dinheiro.
// A Fase 6 substitui por Dinheiro conforme o canvas (Dinheiro.dc.html, planning §5.6).
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { ListRow } from '../components/ui/ListRow';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { useBundle } from '../data/TripContext';
import { CYCLE } from '../lib/identity/accent';
import { Budget, Converter, Pool, StopSpend } from './Mala';
import s from './dinheiro.module.css';

export default function Dinheiro() {
  const { bundle: b, base, canEdit } = useBundle();
  return (
    <div className="wrap">
      <ScreenHeader
        title="Dinheiro"
        subtitle="Orçamento e caixa são a mesma conta."
        action={<Button variant="ghost" size="sm" href={`${base}/dinheiro/orcamento`}>Rever orçamento</Button>}
      />
      <div className={s.grid}>
        <div className={s.col}>
          <Budget cols={CYCLE} />
          <StopSpend cols={CYCLE} />
        </div>
        <div className={s.col}>
          <Pool cols={CYCLE} />
          <Card pad="none">
            <div style={{ padding: '4px 16px' }}>
              <ListRow icon="list" title="Extrato" subtitle={`${b.expenses.length} ${b.expenses.length === 1 ? 'gasto' : 'gastos'} registrados`} href={`${base}/dinheiro/extrato`} />
              <ListRow icon="swap" title="Acerto de contas" subtitle="Quem deve para quem" href={`${base}/dinheiro/acerto`} />
            </div>
          </Card>
          <Converter />
          {!canEdit ? <p className="muted">Você está como leitor: dá pra consultar tudo, sem editar.</p> : null}
        </div>
      </div>
    </div>
  );
}
