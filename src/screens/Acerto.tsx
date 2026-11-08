'use client';
import { useState } from 'react';
import { useBundle } from '../data/TripContext';
import { useAuth } from '../data/AuthContext';
import { balances, suggestTransfers, formatMoney, poolSummary, POOL, type Transfer } from '../lib/money';
import { todayIn } from '../lib/time';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { Button } from '../components/ui/Button';
import { useAction } from '../components/ui/feedback';
import { ContributionSheet } from '../components/money/PoolSheets';
import s from '../components/money/money.module.css';
export default function Acerto() {
  const { bundle: b, base, profileOf, canEdit, isOrganizer, me, source, reload } = useBundle();
  const { online } = useAuth();
  const { run, busy } = useAction();
  const [deposit, setDeposit] = useState(false);
  const net = balances(b.expenses.map((e) => ({ ...e, shares: b.expenseShares.filter((x) => x.expense_id === e.id) })), b.settlements, b.members.map((m) => m.user_id), b.poolContributions);
  const transfers = suggestTransfers(net), pool = poolSummary(b.expenses, b.poolContributions);
  const name = (id: string) => id === POOL ? 'Caixa da turma' : profileOf(id)?.display_name ?? 'Pessoa';
  const money = (c: number) => formatMoney(c, b.trip.base_currency);
  const allowed = (t: Transfer) => canEdit && (t.from === POOL ? isOrganizer : t.to === POOL ? isOrganizer || t.from === me : true);
  const settle = (t: Transfer) => run(async () => {
    if (!allowed(t)) return;
    if (t.from === POOL || t.to === POOL) await source.insert('pool_contributions', { trip_id: b.trip.id, user_id: t.from === POOL ? t.to : t.from, kind: t.from === POOL ? 'refund' : 'deposit', amount_cents: t.cents, contributed_on: todayIn(b.trip.departure_tz), note: 'Acerto de contas' }, { returning: false });
    else await source.insert('settlements', { trip_id: b.trip.id, from_user: t.from, to_user: t.to, amount_cents: t.cents, paid_on: todayIn(b.trip.departure_tz) }, { returning: false });
    await reload();
  }, { success: 'Pagamento registrado.' });
  return <div className="wrap"><ScreenHeader title="Acerto de contas" back={`${base}/dinheiro`} subtitle="Quem tem a receber e quem precisa completar." /><div className={s.grid}><section className={s.panel}><h2 className={s.heading}>Saldo por pessoa</h2>{[...net].map(([id, cents]) => <div key={id} className={s.item}><span>{name(id)}</span><span><b>{money(Math.abs(cents))}</b><small>{cents === 0 ? 'acertado' : id === POOL ? cents > 0 ? 'faltou no caixa' : 'a devolver' : cents > 0 ? 'a receber' : 'a pagar'}</small></span></div>)}</section><section className={`${s.panel} ${s.stack}`}><h2 className={s.heading}>Transferências sugeridas</h2>{transfers.map((t) => <div key={`${t.from}:${t.to}`} className={s.item}><span>{name(t.from)} → {name(t.to)}<small>{money(t.cents)}</small></span>{allowed(t) ? <Button size="sm" disabled={busy || !online} onClick={() => void settle(t)}>Marcar como pago</Button> : null}</div>)}{!transfers.length ? <p>Tudo acertado. Ninguém deve nada.</p> : null}<div className={s.note}>{pool.balance >= 0 ? `Sobrou ${money(pool.balance)} no caixa. As devoluções acima respeitam o saldo de cada pessoa.` : `Faltou ${money(-pool.balance)} no caixa.`}</div>{pool.balance < 0 && canEdit ? <Button onClick={() => setDeposit(true)}>Registrar aporte</Button> : null}<Button variant="ghost" href={`${base}/dinheiro/extrato`}>Ver pagamentos no extrato</Button></section></div>{deposit ? <ContributionSheet onClose={() => setDeposit(false)} /> : null}</div>;
}
