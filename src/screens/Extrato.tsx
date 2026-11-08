'use client';
import { useState } from 'react';
import { useBundle } from '../data/TripContext';
import { useAuth } from '../data/AuthContext';
import { filterMovements, ledger, movementsCsv, formatMoney, POOL, type Movement, type MovementFilter } from '../lib/money';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { Button } from '../components/ui/Button';
import { Chip } from '../components/ui/Chip';
import { EmptyState } from '../components/ui/EmptyState';
import { Sheet } from '../components/ui/Sheet';
import { useAction, useConfirm } from '../components/ui/feedback';
import { ExpenseSheet } from '../components/money/ExpenseSheet';
import { ContributionSheet } from '../components/money/PoolSheets';
import s from '../components/money/money.module.css';
export default function Extrato() {
  const { bundle: b, base, canEdit, profileOf, source, reload } = useBundle();
  const { online } = useAuth();
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const [filter, setFilter] = useState<MovementFilter>({ type: 'all' });
  const [edit, setEdit] = useState<Movement>();
  const list = filterMovements(ledger(b), filter);
  const days = [...new Set(list.map((m) => m.date))];
  const nameOf = (id: string) => id === POOL ? 'Caixa da turma' : profileOf(id)?.display_name ?? 'Pessoa';
  const csv = () => {
    const content = movementsCsv(list, { base: b.trip.base_currency, nameOf, categoryOf: (id) => b.budgetCategories.find((c) => c.id === id)?.name ?? '', stopOf: (id) => b.stops.find((st) => st.id === id)?.name ?? '' });
    const url = URL.createObjectURL(new Blob(['\uFEFF', content], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'trilha-extrato.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className="wrap"><ScreenHeader title="Extrato" back={`${base}/dinheiro`} subtitle="Tudo que entrou, saiu e foi acertado." action={<Button size="sm" variant="secondary" onClick={csv}>Exportar CSV</Button>} /><div className={s.stack}>
    <label className="field">Buscar por descrição<input type="search" value={filter.q ?? ''} onChange={(e) => setFilter({ ...filter, q: e.target.value })} /></label>
    <div className={s.chips}>{(['all', 'expenses', 'pool'] as const).map((type, i) => <Chip key={type} selected={filter.type === type} onClick={() => setFilter({ ...filter, type })}>{['Todos', 'Gastos', 'Aportes e devoluções'][i]}</Chip>)}</div>
    <details><summary>Categoria, parada e pessoa</summary><div className={s.chips}>{(['categoryId', 'stopId', 'person'] as const).map((key, i) => <label className="field" key={key}>{['Categoria', 'Parada', 'Pessoa'][i]}<select value={filter[key] ?? ''} onChange={(e) => setFilter({ ...filter, [key]: e.target.value })}><option value="">Todas</option>{(key === 'categoryId' ? b.budgetCategories.map((x) => ({ id: x.id, name: x.name })) : key === 'stopId' ? b.stops.map((x) => ({ id: x.id, name: x.name })) : [{ id: POOL, name: nameOf(POOL) }, ...b.members.map((m) => ({ id: m.user_id, name: nameOf(m.user_id) }))]).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>)}</div></details>
    {!list.length ? <EmptyState title="Nenhum movimento encontrado" text="Tente outros filtros ou lance um gasto no Dinheiro." action={<Button href={`${base}/dinheiro`}>Ir para Dinheiro</Button>} /> : null}
    {days.map((day) => <section key={day} className={s.panel}><h2 className={s.heading}>{day.split('-').reverse().join('/')}</h2>{list.filter((m) => m.date === day).map((m) => <div key={`${m.kind}:${m.id}`} className={s.item}><span><b>{m.title}</b><small>{nameOf(m.who)}{m.to ? ` → ${nameOf(m.to)}` : ''} · {b.budgetCategories.find((c) => c.id === m.categoryId)?.name}{m.original ? ` · ${formatMoney(m.original.cents, m.original.currency)}` : ''}</small></span><b>{formatMoney(m.cents, b.trip.base_currency)}</b>{canEdit ? <Button size="sm" variant="ghost" aria-label={`Abrir ${m.title}`} onClick={() => setEdit(m)}>Abrir</Button> : null}</div>)}</section>)}
  </div>{edit?.kind === 'expense' ? <ExpenseSheet expense={b.expenses.find((e) => e.id === edit.id)} onClose={() => setEdit(undefined)} /> : edit?.kind === 'deposit' || edit?.kind === 'refund' ? <ContributionSheet entry={b.poolContributions.find((e) => e.id === edit.id)} onClose={() => setEdit(undefined)} /> : edit ? <Sheet open title="Pagamento entre a turma" onClose={() => setEdit(undefined)} footer={<Button disabled={busy || !online} variant="secondary" onClick={async () => { if (await confirm({ title: 'Desfazer pagamento?', message: 'Os saldos da turma serão recalculados.' })) await run(() => source.remove('settlements', { id: edit.id }).then(reload).then(() => setEdit(undefined))); }}>Desfazer pagamento</Button>}><p>{nameOf(edit.who)} → {nameOf(edit.to!)} · {formatMoney(edit.cents, b.trip.base_currency)}</p></Sheet> : null}</div>;
}
