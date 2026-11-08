'use client';
import { useState } from 'react';
import { useBundle } from '../../data/TripContext';
import { useAuth } from '../../data/AuthContext';
import type { PoolContribution } from '../../data/types';
import { memberPoolStatus, poolQuickAmounts, poolSummary, formatMoney, toCents, centsToDecimal } from '../../lib/money';
import { todayIn } from '../../lib/time';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { MoneyInput } from '../ui/MoneyInput';
import { Sheet } from '../ui/Sheet';
import { useAction, useConfirm } from '../ui/feedback';
import s from './money.module.css';
export function ContributionSheet({ entry, userId, onClose }: { entry?: PoolContribution; userId?: string; onClose: () => void }) {
  const { bundle: b, me, source, reload, profileOf, isOrganizer, canEdit } = useBundle();
  const { online } = useAuth();
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const [who, setWho] = useState(entry?.user_id ?? (isOrganizer ? userId : null) ?? me);
  const [value, setValue] = useState<number | null>(entry?.amount_cents ?? null);
  const [kind, setKind] = useState<'deposit' | 'refund'>(entry?.kind ?? 'deposit');
  const [date, setDate] = useState(entry?.contributed_on ?? todayIn(b.trip.departure_tz));
  const [note, setNote] = useState(entry?.note ?? '');
  const quick = poolQuickAmounts(memberPoolStatus(b).find((m) => m.userId === who));
  const proposed = { id: 'preview', trip_id: b.trip.id, user_id: who, kind, amount_cents: value ?? 0, contributed_on: date, note, created_by: me, created_at: new Date().toISOString() };
  const preview = { ...b, poolContributions: [...b.poolContributions.filter((x) => x.id !== entry?.id), proposed] };
  const after = memberPoolStatus(preview).find((m) => m.userId === who);
  const canDelete = canEdit && (isOrganizer || entry?.created_by === me && entry?.user_id === me && entry?.kind === 'deposit');
  const valid = canEdit && online && !entry && !!date && value != null && value > 0 && value <= 100000000000 && (isOrganizer || who === me && kind === 'deposit');
  const money = (v: number) => formatMoney(v, b.trip.base_currency);
  return <Sheet open title={entry ? 'Movimento do caixa' : 'Aporte no caixa'} onClose={onClose} footer={<>
    {entry && canDelete ? <Button variant="ghost" disabled={busy || !online} onClick={async () => { if (await confirm({ title: 'Excluir movimento?', message: 'O saldo do caixa e a cota da pessoa serão recalculados.' })) await run(() => source.remove('pool_contributions', { id: entry.id }).then(reload).then(onClose)); }}>Excluir</Button> : null}
    {!entry ? <Button disabled={!valid || busy} onClick={() => void run(async () => { if (!valid) return; await source.insert('pool_contributions', { trip_id: b.trip.id, user_id: who, kind, amount_cents: value, contributed_on: date, note: note.trim() || null }, { returning: false }); await reload(); onClose(); }, { success: kind === 'deposit' ? 'Aporte registrado.' : 'Devolução registrada.' })}>Salvar {kind === 'deposit' ? 'aporte' : 'devolução'}</Button> : null}
  </>}><div className={s.form}>
    {!online ? <p>Precisa de internet para salvar.</p> : null}
    {entry ? <p className={s.note}>Movimentos do caixa não são editados. Para corrigir, exclua e registre novamente.</p> : null}
    <fieldset><legend>Quem</legend><div className={s.chips}>{b.members.filter((m) => isOrganizer || m.user_id === who).map((m) => <Chip key={m.user_id} disabled={!!entry} selected={who === m.user_id} onClick={() => setWho(m.user_id)}>{profileOf(m.user_id)?.display_name ?? 'Pessoa'}</Chip>)}</div></fieldset>
    {entry ? <strong>{money(entry.amount_cents)}</strong> : <><MoneyInput label="Valor do aporte" currency={b.trip.base_currency} value={value} onChange={setValue} autoFocus />{quick && kind === 'deposit' ? <div className={s.chips}><Chip onClick={() => setValue(quick.missing)}>O que falta ({money(quick.missing)})</Chip><Chip onClick={() => setValue(quick.half)}>Metade ({money(quick.half)})</Chip><Chip onClick={() => setValue(null)}>Outro</Chip></div> : null}</>}
    <div className={s.chips}><Chip selected={kind === 'deposit'} disabled={!!entry} onClick={() => setKind('deposit')}>Aporte</Chip>{isOrganizer || kind === 'refund' ? <Chip selected={kind === 'refund'} disabled={!!entry} onClick={() => setKind('refund')}>Devolução</Chip> : null}</div>
    <label className="field">Data<input type="date" disabled={!!entry} value={date} onChange={(e) => setDate(e.target.value)} /></label>
    <label className="field">Nota (opcional)<input maxLength={300} disabled={!!entry} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Pix 12/11" /></label>
    {!entry && after && value ? <div className={s.note} aria-live="polite">{profileOf(who)?.display_name} fica com {money(after.depositedCents)} de {money(after.targetCents)} · {after.status === 'completo' || after.status === 'em_dia' ? 'em dia ✓' : `faltam ${money(Math.max(0, after.targetCents - after.depositedCents))}`}<br />Caixa vai a {money(poolSummary(preview.expenses, preview.poolContributions).balance)}.</div> : null}
  </div></Sheet>;
}
export function QuotasSheet({ onClose }: { onClose: () => void }) {
  const { bundle: b, source, reload, profileOf, isOrganizer } = useBundle();
  const { online } = useAuth();
  const { run, busy } = useAction();
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(b.members.map((m) => [m.user_id, m.pool_target_cents == null ? '' : centsToDecimal(m.pool_target_cents)])));
  const valid = Object.values(values).every((v) => !v || Number.isFinite(toCents(v)) && toCents(v) >= 0 && toCents(v) <= 100000000000);
  return <Sheet open title="Definir cotas" onClose={onClose} footer={<Button disabled={!isOrganizer || !online || busy || !valid} onClick={() => void run(async () => {
    for (const m of b.members) await source.updateWhere('trip_members', { trip_id: b.trip.id, user_id: m.user_id }, { pool_target_cents: values[m.user_id] ? toCents(values[m.user_id]) : null });
    await reload(); onClose();
  }, { success: 'Cotas atualizadas.' })}>Salvar cotas</Button>}><div className={s.form}><p>Deixe vazio para dividir o planejado igualmente. Zero significa que a pessoa não tem cota.</p>{b.members.map((m) => <label className="field" key={m.user_id}>{profileOf(m.user_id)?.display_name} ({b.trip.base_currency})<input inputMode="decimal" value={values[m.user_id]} placeholder="Igual para todos" onChange={(e) => setValues({ ...values, [m.user_id]: e.target.value })} /></label>)}<Button variant="secondary" onClick={() => setValues(Object.fromEntries(b.members.map((m) => [m.user_id, ''])))}>Todos iguais</Button></div></Sheet>;
}
