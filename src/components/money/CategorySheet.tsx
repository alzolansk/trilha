'use client';
import { useState } from 'react';
import { useBundle } from '../../data/TripContext';
import { useAuth } from '../../data/AuthContext';
import { categoryStatus, formatMoney } from '../../lib/money';
import { Button } from '../ui/Button';
import { MoneyInput } from '../ui/MoneyInput';
import { Sheet } from '../ui/Sheet';
import { useAction } from '../ui/feedback';
import { ExpenseSheet, type PaymentLink } from './ExpenseSheet';
import type { Expense } from '../../data/types';
import { useFx } from './useFx';
import s from './money.module.css';
export function CategorySheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { bundle: b, source, reload, canEdit } = useBundle();
  const { online } = useAuth();
  const { rates } = useFx(b.trip.base_currency);
  const cat = categoryStatus(b, rates).find((c) => c.id === id)!;
  const row = b.budgetCategories.find((c) => c.id === id)!;
  const [value, setValue] = useState<number | null>(cat.plannedCents);
  const [preset, setPreset] = useState<PaymentLink>();
  const [expense, setExpense] = useState<Expense>();
  const { run, busy } = useAction();
  return <><Sheet open title={cat.name} onClose={onClose} footer={canEdit ? <Button disabled={busy || !online || value == null || value < 0} onClick={() => void run(() => source.update('budget_categories', id, { planned: ((value ?? 0) / 100).toFixed(2) }, row.version).then(reload).then(onClose), { success: 'Planejado atualizado.' })}>Salvar planejado</Button> : undefined}><div className={s.form}>
    {canEdit ? <MoneyInput label="Planejado para a turma" currency={b.trip.base_currency} value={value} onChange={setValue} /> : <p>Planejado: {formatMoney(cat.plannedCents, b.trip.base_currency)}</p>}
    <h3>Gastos desta categoria</h3>{b.expenses.filter((e) => e.category_id === id).map((e) => <div key={e.id} className={s.item}><span>{e.description}</span>{canEdit ? <Button size="sm" variant="ghost" onClick={() => setExpense(e)}>Editar gasto</Button> : null}</div>)}
    <h3>Itens ainda não pagos</h3>{cat.items.filter((i) => !i.paid).map((i) => <div key={i.id} className={s.item}><span>{i.title}<small>{i.costCents == null ? 'Sem preço' : `${i.isEstimate ? '≈ ' : ''}${formatMoney(i.costCents, b.trip.base_currency)}${i.isEstimate ? ' · ESTIMATIVA' : ''}`}</small></span>{canEdit ? <Button size="sm" variant="secondary" onClick={() => setPreset(i)}>Marcar como pago</Button> : null}</div>)}
    {!cat.items.some((i) => !i.paid) ? <p className={s.muted}>Nenhum item do roteiro pendente nesta categoria.</p> : null}
  </div></Sheet>{preset || expense ? <ExpenseSheet preset={preset} expense={expense} onClose={() => { setPreset(undefined); setExpense(undefined); }} /> : null}</>;
}
