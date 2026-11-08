'use client';
import { useState } from 'react';
import { useBundle } from '../../data/TripContext';
import { useAuth } from '../../data/AuthContext';
import type { Expense } from '../../data/types';
import { currencyForCountry } from '../../lib/currency';
import { todayIn } from '../../lib/time';
import { categoryKind, centsToDecimal, convertCents, customSplit, expenseImpact, formatMoney, itemLabel, paymentPreset, poolSummary, POOL, splitEqual, toCents, unpaidItems, type ItemType } from '../../lib/money';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { Checkbox } from '../ui/Checkbox';
import { MoneyInput } from '../ui/MoneyInput';
import { Sheet } from '../ui/Sheet';
import { useAction, useConfirm } from '../ui/feedback';
import { useFx } from './useFx';
import s from './money.module.css';

export type PaymentLink = { type: ItemType; id: string };
export function ExpenseSheet({ expense: e, preset, onClose }: { expense?: Expense; preset?: PaymentLink; onClose: () => void }) {
  const { bundle: b, source, reload, me, profileOf, canEdit } = useBundle();
  const { online } = useAuth();
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const base = b.trip.base_currency;
  const { fx, rates } = useFx(base);
  const initial = preset ? paymentPreset(b, preset.type, preset.id, rates) : null;
  const today = todayIn(b.trip.departure_tz);
  const current = b.stops.find((st) => st.arrival_date <= today && st.departure_date >= today);
  const [link, setLink] = useState<PaymentLink | undefined>(preset ?? (e?.activity_id ? { type: 'activity', id: e.activity_id } : e?.stay_id ? { type: 'stay', id: e.stay_id } : e?.transport_id ? { type: 'transport', id: e.transport_id } : undefined));
  const [amount, setAmount] = useState<number | null>(e ? toCents(e.amount) : initial?.cents ?? null);
  const [v, setV] = useState({ description: e?.description ?? initial?.description ?? '', currency: e?.currency ?? (preset ? base : currencyForCountry(current?.country ?? '') ?? base), category: e?.category_id ?? initial?.categoryId ?? '', stop: e?.stop_id ?? initial?.stopId ?? current?.id ?? '', date: e?.spent_on ?? today, payer: e?.paid_from_pool ? POOL : e?.payer_id ?? (poolSummary(b.expenses, b.poolContributions).balance > 0 ? POOL : me), manual: e?.rate_is_manual ?? false, rate: e ? String(e.rate_to_base) : '' });
  const ids = b.members.map((m) => m.user_id);
  const oldShares = e ? b.expenseShares.filter((x) => x.expense_id === e.id) : [];
  const [mode, setMode] = useState<'all' | 'choose' | 'custom'>(e && !e.paid_from_pool ? 'custom' : 'all');
  const [selected, setSelected] = useState(oldShares.length ? oldShares.map((x) => x.user_id) : ids);
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(ids.map((id) => { const share = oldShares.find((x) => x.user_id === id); return [id, share ? centsToDecimal(share.share_cents).replace('.', ',') : '']; })));
  const keep = e && e.currency === v.currency && !v.manual;
  const rawRate = v.currency === base ? 1 : v.manual ? Number(v.rate.replace(',', '.')) : keep ? Number(e.rate_to_base) : rates[v.currency];
  const rate = rawRate ? Number(rawRate.toFixed(8)) : 0;
  const cents = rate > 0 && Number.isFinite(rate) ? convertCents(amount ?? 0, rate) : 0;
  const different = customSplit(cents, Object.fromEntries(Object.entries(values).map(([id, text]) => [id, text ? toCents(text) : null])));
  const shares = v.payer === POOL || mode === 'all' ? splitEqual(cents, ids) : mode === 'choose' ? splitEqual(cents, selected) : different.shares;
  const splitOk = v.payer === POOL || mode !== 'custom' || different.diff === 0 && Object.values(values).every((text) => !text || Number.isFinite(toCents(text)) && toCents(text) >= 0);
  const valid = canEdit && online && !!v.description.trim() && !!v.date && cents > 0 && cents <= 100000000000 && shares.length > 0 && splitOk;
  const draft = { id: e?.id, baseCents: cents, category_id: v.category || null, paid_from_pool: v.payer === POOL, activity_id: link?.type === 'activity' ? link.id : null, stay_id: link?.type === 'stay' ? link.id : null, transport_id: link?.type === 'transport' ? link.id : null };
  const impact = expenseImpact(draft, b);
  const rateSource = v.currency === base ? 'Mesma moeda' : v.manual ? 'Taxa manual' : keep ? e.rate_source : fx?.source ?? '';
  const rateDate = v.currency === base ? v.date : v.manual ? today : keep ? e.rate_date : fx?.date ?? today;
  const choose = (item: PaymentLink) => {
    const p = paymentPreset(b, item.type, item.id, rates);
    setLink(item); setAmount(p.cents); setV({ ...v, description: p.description, category: p.categoryId ?? '', stop: p.stopId ?? '', currency: base, manual: false });
  };
  const save = (linked: boolean) => run(async () => {
    if (!valid) return;
    await source.rpc('save_expense', { p_expense: {
      id: e?.id ?? '', version: e?.version ?? '', trip_id: b.trip.id, description: v.description.trim(), category_id: v.category, stop_id: v.stop,
      payer_id: v.payer === POOL ? (e?.paid_from_pool ? e.payer_id : me) : v.payer, paid_from_pool: v.payer === POOL,
      amount: centsToDecimal(amount!), currency: v.currency, rate_to_base: Number(rate.toFixed(8)), rate_source: rateSource, rate_date: rateDate, rate_is_manual: v.currency !== base && v.manual, base_amount: centsToDecimal(cents), spent_on: v.date,
      activity_id: linked ? draft.activity_id : null, stay_id: linked ? draft.stay_id : null, transport_id: linked ? draft.transport_id : null,
    }, p_shares: shares });
    await reload(); onClose();
  }, { success: 'Gasto salvo.' });
  const suggestions = unpaidItems(b, rates).filter((i) => v.description.trim() && i.title.toLocaleLowerCase().includes(v.description.toLocaleLowerCase()) && i.id !== link?.id).slice(0, 5);
  const currencies = [...new Set([base, ...b.stops.map((st) => currencyForCountry(st.country)).filter((c): c is string => !!c), 'USD', v.currency])];
  return <Sheet open title={e ? 'Editar gasto' : 'Lançar gasto'} onClose={onClose} footer={<>
    {e && canEdit ? <Button variant="ghost" disabled={busy || !online} onClick={async () => { if (await confirm({ title: 'Excluir gasto?', message: `${e.description} sai das contas e perde o vínculo de pagamento.` })) await run(() => source.remove('expenses', { id: e.id }).then(reload).then(onClose)); }}>Excluir</Button> : null}
    {link ? <Button variant="secondary" disabled={!valid || busy} onClick={() => void save(false)}>Salvar sem ligar</Button> : null}
    <Button disabled={!valid || busy} onClick={() => void save(true)}>{busy ? 'Salvando…' : link ? 'Salvar e marcar como pago' : 'Salvar gasto'}</Button>
  </>}><div className={s.form}>
    {!online ? <p>Precisa de internet para salvar.</p> : null}
    <MoneyInput autoFocus label="Valor do gasto" value={amount} onChange={setAmount} currency={v.currency} />
    <div className={s.chips} aria-label="Moeda">{currencies.map((c) => <Chip key={c} selected={c === v.currency} onClick={() => setV({ ...v, currency: c, manual: false })}>{c}</Chip>)}</div>
    {v.currency !== base ? <div className={s.note}>
      {rate > 0 ? <p>≈ {formatMoney(cents, base)} · cotação de {rateDate}, fonte {rateSource}</p> : <p>Cotação indisponível. Informe uma taxa manual.</p>}
      <Checkbox label="Usar taxa manual" checked={v.manual} onChange={(manual) => setV({ ...v, manual })} />
      {v.manual ? <label className="field">1 {v.currency} vale quantos {base}?<input inputMode="decimal" value={v.rate} onChange={(ev) => setV({ ...v, rate: ev.target.value })} /></label> : null}
    </div> : null}
    <label className="field">Descrição<input value={v.description} maxLength={120} onChange={(ev) => { const description = ev.target.value; const kind = categoryKind({ name: description }); setV({ ...v, description, category: v.category || (kind !== 'outro' ? b.budgetCategories.find((c) => categoryKind(c) === kind)?.id ?? '' : '') }); }} placeholder="Ex.: ingresso Vale Sagrado" /></label>
    {suggestions.length ? <div className={s.stack} aria-label="Itens ainda não pagos">{suggestions.map((i) => <Button key={i.id} variant="secondary" onClick={() => choose(i)}>{i.title} · ligar ao roteiro</Button>)}</div> : null}
    {link ? <div className={s.note}>Ligado ao roteiro: {itemLabel(b, link.type, link.id)} <Button variant="ghost" size="sm" onClick={() => setLink(undefined)}>Desligar</Button></div> : null}
    <fieldset><legend>Categoria</legend><div className={s.chips}><Chip selected={!v.category} onClick={() => setV({ ...v, category: '' })}>Sem categoria</Chip>{b.budgetCategories.map((c) => <Chip key={c.id} selected={v.category === c.id} onClick={() => setV({ ...v, category: c.id })}>{c.name}</Chip>)}</div></fieldset>
    <fieldset><legend>Quem pagou</legend><div className={s.chips}>{[POOL, ...ids].map((id) => <Chip key={id} selected={v.payer === id} onClick={() => setV({ ...v, payer: id })}>{id === POOL ? 'Caixa da turma' : profileOf(id)?.display_name ?? 'Pessoa'}</Chip>)}</div></fieldset>
    {v.payer !== POOL ? <fieldset><legend>Dividir entre</legend><div className={s.chips}>{(['all', 'choose', 'custom'] as const).map((m, i) => <Chip key={m} selected={mode === m} onClick={() => setMode(m)}>{['Todos igual', 'Escolher pessoas', 'Valores diferentes'][i]}</Chip>)}</div>
      {mode === 'choose' ? ids.map((id) => <Checkbox key={id} label={profileOf(id)?.display_name ?? 'Pessoa'} checked={selected.includes(id)} onChange={(on) => setSelected(on ? [...selected, id] : selected.filter((x) => x !== id))} />) : null}
      {mode === 'custom' ? <div className={s.stack}>{ids.map((id) => <label className="field" key={id}>{profileOf(id)?.display_name} ({base})<input inputMode="decimal" value={values[id]} onChange={(ev) => setValues({ ...values, [id]: ev.target.value })} /></label>)}{different.diff !== 0 ? <p role="alert">A divisão precisa fechar o total. Diferença: {formatMoney(different.diff, base)}.</p> : null}</div> : null}
    </fieldset> : <p className={s.muted}>Pago pelo caixa e dividido igualmente entre toda a turma.</p>}
    <details><summary>Data e parada</summary><div className={s.stack}><label className="field">Data<input type="date" value={v.date} onChange={(ev) => setV({ ...v, date: ev.target.value })} /></label><label className="field">Parada<select value={v.stop} onChange={(ev) => setV({ ...v, stop: ev.target.value })}><option value="">Nenhuma</option>{b.stops.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}</select></label></div></details>
    {cents > 0 ? <div className={`${s.note} ${impact.category?.over || impact.pool?.negative ? s.warning : ''}`} aria-live="polite">
      {impact.category ? <div>Baixa {formatMoney(cents, base)} de {impact.category.name} · {impact.category.over ? 'passou' : 'sobram'} {formatMoney(Math.abs(impact.category.plannedCents - impact.category.afterCents), base)}.</div> : null}
      {impact.pool ? <div>Caixa fica com {formatMoney(impact.pool.afterCents, base)}.</div> : null}
      {link ? <div>{itemLabel(b, link.type, link.id)} será marcado como pago.</div> : null}
    </div> : null}
  </div></Sheet>;
}

/** Usado nos três Sheets do roteiro. Abre somente para itens já salvos. */
export function PayItem({ type, id }: PaymentLink) {
  const { bundle: b, canEdit } = useBundle();
  const [open, setOpen] = useState(false);
  const paid = b.expenses.some((e) => (type === 'activity' ? e.activity_id : type === 'stay' ? e.stay_id : e.transport_id) === id);
  return <>{paid ? <p className={s.note}>Pago ✓</p> : canEdit ? <Button variant="secondary" onClick={() => setOpen(true)}>Marcar como pago</Button> : null}{open ? <ExpenseSheet preset={{ type, id }} onClose={() => setOpen(false)} /> : null}</>;
}
