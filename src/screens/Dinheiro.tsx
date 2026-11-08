'use client';
import { useState } from 'react';
import { useBundle } from '../data/TripContext';
import { useAuth } from '../data/AuthContext';
import { budgetOverview, categoryContext, categoryStatus, formatMoney, itemLabel, ledger, memberPoolStatus, POOL, recentHit } from '../lib/money';
import { todayIn } from '../lib/time';
import { initials } from '../lib/format';
import { Button } from '../components/ui/Button';
import { ListRow } from '../components/ui/ListRow';
import { EmptyState } from '../components/ui/EmptyState';
import { Progress } from '../components/ui/Progress';
import { Stat } from '../components/ui/Stat';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { Sheet } from '../components/ui/Sheet';
import { useAction } from '../components/ui/feedback';
import { ExpenseSheet } from '../components/money/ExpenseSheet';
import { ContributionSheet, QuotasSheet } from '../components/money/PoolSheets';
import { CategorySheet } from '../components/money/CategorySheet';
import { Converter } from '../components/money/Converter';
import s from '../components/money/money.module.css';
export default function Dinheiro() {
  const { bundle: b, base, canEdit, isOrganizer, profileOf, source, reload } = useBundle();
  const { online } = useAuth();
  const { run, busy } = useAction();
  const [sheet, setSheet] = useState<'choice' | 'expense' | 'pool' | 'quotas' | null>(null);
  const [category, setCategory] = useState<string>();
  const o = budgetOverview(b), members = memberPoolStatus(b), last = ledger(b)[0], hit = recentHit(b);
  const money = (c: number) => formatMoney(c, b.trip.base_currency, { compact: true });
  const name = (id: string) => id === POOL ? 'Caixa da turma' : profileOf(id)?.display_name ?? 'Pessoa';
  const remind = () => run(async () => {
    const fresh = await source.load();
    for (const m of memberPoolStatus(fresh).filter((p) => p.status === 'atrasado')) {
      const key = `pool:${m.userId}`;
      const old = fresh.tasks.find((t) => t.alert_key === key);
      if (old && old.status !== 'done' && !old.dismissed) continue;
      const row = { title: `Aporte de ${money(m.targetCents - m.depositedCents)} no caixa`, source: 'rules', assignee_id: m.userId, due_date: todayIn(b.trip.departure_tz), alert_key: key, link: 'mala', status: 'todo', dismissed: false };
      if (old) await source.update('tasks', old.id, row, old.version);
      else await source.insert('tasks', { trip_id: b.trip.id, ...row }, { returning: false });
    }
    await reload();
  }, { success: 'Lembretes criados para quem está atrasado.' });
  return <div className={`wrap ${s.moneyPage}`}>
    <ScreenHeader inlineAction title="Dinheiro" subtitle="Orçamento e caixa são a mesma conta." action={<Button variant="ghost" size="sm" href={`${base}/dinheiro/orcamento`}>Rever orçamento</Button>} />
    <div className={s.grid}><div className={s.stack}>
      {!b.budgetCategories.some((c) => Number(c.planned) > 0) ? <EmptyState title="Ainda não tem orçamento" text="Monte uma previsão e acompanhe o caixa da turma." action={<Button href={`${base}/dinheiro/orcamento`}>Montar com a Trilha</Button>} /> : null}
      <section className={`${s.panel} ${s.stack}`} aria-label="Resumo do dinheiro"><div className={s.stats}><Stat label="Planejado" value={money(o.plannedCents)} /><Stat label="Juntado" value={<span style={{ color: 'var(--brand)' }}>{money(o.pooledCents)}</span>} /><Stat label="Já gasto" value={<span style={{ color: 'var(--warn)' }}>{money(o.spentCents)}</span>} /></div>
        <Progress label="Juntado e gasto sobre o planejado" height={12} layers={[{ value: o.pooledCents / (o.plannedCents || 1), color: '#c7ceff', label: 'Juntado' }, { value: o.spentCents / (o.plannedCents || 1), color: 'var(--sun)', label: 'Gasto' }]} />
        <div className={s.row}><span className={s.muted}>Saldo no caixa agora</span><b data-testid="pool-balance">{money(o.poolBalanceCents)}</b></div>
      </section>
      <h2 className={s.heading}>Por categoria</h2>
      {categoryStatus(b).map((c) => <button key={c.id} className={`${s.panel} ${s.category}`} data-hit={hit?.categoryId === c.id} onClick={() => setCategory(c.id)} aria-label={`Categoria ${c.name}`}><div className={s.row}><b>{c.name}</b><span><b>{money(c.spentCents)}</b> <span className={s.muted}>de {money(c.plannedCents)}</span></span></div><Progress label={`Gasto em ${c.name}`} value={c.spentCents / (c.plannedCents || 1)} color={`var(--cat-${c.kind}, var(--brand))`} /><small className={s.muted}>{hit?.categoryId === c.id ? `Acabou de baixar: ${hit.description}` : categoryContext(b, c)}</small></button>)}
    </div><div className={s.stack}>
      <h2 className={s.heading}>Último movimento</h2>
      {last ? <section className={s.panel}><div className={s.item}><span><b>{last.title}</b><small>{last.date.split('-').reverse().join('/')} · {name(last.who)}</small></span><b>{money(last.cents)}</b></div>{last.item ? <div className={s.note}>{name(last.who)} → {b.budgetCategories.find((c) => c.id === last.categoryId)?.name ?? 'Gasto'} → {itemLabel(b, last.item.type, last.item.id)} ✓ pago</div> : null}<Button href={`${base}/dinheiro/extrato`} variant="ghost" size="sm">Ver extrato</Button></section> : <EmptyState compact title="Sem movimentos" text="O primeiro gasto ou aporte aparece aqui." />}
      <h2 className={s.heading}>Cada um no caixa</h2>
      <section className={s.panel} aria-label="Cada um no caixa">{members.map((m) => <div key={m.userId} className={s.item}><span className={s.avatar}>{initials(name(m.userId))}</span><span style={{ flex: 1 }}><b>{name(m.userId)}</b><small>{m.status === 'completo' || m.status === 'em_dia' ? 'em dia ✓' : m.status === 'sem_meta' ? 'sem meta' : `faltam ${money(Math.max(0, m.targetCents - m.depositedCents))}`}</small></span><span><b>{money(m.depositedCents)}</b><small>/ {money(m.targetCents)}</small></span></div>)}
        {isOrganizer ? <div className={s.chips}><Button variant="ghost" size="sm" onClick={() => setSheet('quotas')}>Definir cotas</Button><Button variant="ghost" size="sm" disabled={busy || !online || !members.some((m) => m.status === 'atrasado')} onClick={() => void remind()}>Lembrar quem está atrasado</Button></div> : null}
      </section>
      {canEdit ? <div className={`${s.desktopAction} ${s.chips}`}><Button onClick={() => setSheet('expense')}>Lançar gasto</Button><Button variant="secondary" onClick={() => setSheet('pool')}>Aporte no caixa</Button></div> : null}
      <section className={s.panel}><ListRow icon="list" title="Extrato" subtitle={`${ledger(b).length} movimentos`} href={`${base}/dinheiro/extrato`} /><ListRow icon="swap" title="Acerto de contas" subtitle="Saldos e transferências da turma" href={`${base}/dinheiro/acerto`} /></section><Converter />
    </div></div>
    {canEdit ? <div className={s.mobileAction}><Button onClick={() => setSheet('choice')}>Lançar gasto ou aporte</Button></div> : null}
    {sheet === 'choice' ? <Sheet open title="O que entrou ou saiu?" onClose={() => setSheet(null)}><div className={s.stack}><Button onClick={() => setSheet('expense')}>Gasto</Button><Button variant="secondary" onClick={() => setSheet('pool')}>Aporte no caixa</Button></div></Sheet> : null}
    {sheet === 'expense' ? <ExpenseSheet onClose={() => setSheet(null)} /> : null}{sheet === 'pool' ? <ContributionSheet onClose={() => setSheet(null)} /> : null}{sheet === 'quotas' ? <QuotasSheet onClose={() => setSheet(null)} /> : null}{category ? <CategorySheet id={category} onClose={() => setCategory(undefined)} /> : null}
  </div>;
}
