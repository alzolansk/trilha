'use client';
import { useState } from 'react';
import { useBundle } from '../../data/TripContext';
import { useAuth } from '../../data/AuthContext';
import type { PoolContribution } from '../../data/types';
import { memberPoolStatus, poolQuickAmounts, poolSummary, formatMoney, toCents, centsToDecimal } from '../../lib/money';
import { todayIn } from '../../lib/time';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Chip } from '../ui/Chip';
import { MoneyInput } from '../ui/MoneyInput';
import { Sheet } from '../ui/Sheet';
import { useAction, useConfirm } from '../ui/feedback';
import s from './money.module.css';

/**
 * Quem pode excluir um movimento do caixa (mesma regra da policy pool_contributions_delete, migration 00009):
 * o organizador exclui qualquer um; quem edita exclui o próprio aporte que ele mesmo lançou.
 */
export function canDeleteContribution(entry: PoolContribution, who: { me: string; isOrganizer: boolean; canEdit: boolean }): boolean {
  if (!who.canEdit) return false;
  return who.isOrganizer || (entry.created_by === who.me && entry.user_id === who.me && entry.kind === 'deposit');
}

/** Excluir um aporte/devolução com confirmação (o caixa e a cota são recalculados). */
function useDeleteContribution() {
  const { bundle: b, source, reload } = useBundle();
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const remove = async (entry: PoolContribution, after?: () => void) => {
    const money = formatMoney(entry.amount_cents, b.trip.base_currency);
    const what = entry.kind === 'deposit' ? 'aporte' : 'devolução';
    if (!(await confirm({ title: `Excluir ${what} de ${money}?`, message: 'O saldo do caixa e a cota da pessoa serão recalculados. Se foi engano, é só registrar de novo o valor certo.', confirmLabel: 'Excluir' }))) return;
    await run(async () => {
      await source.remove('pool_contributions', { id: entry.id });
      await reload();
      after?.();
    }, { success: `${what === 'aporte' ? 'Aporte excluído' : 'Devolução excluída'}.` });
  };
  return { remove, busy };
}

const dateBr = (d: string) => d.split('-').reverse().join('/');

/** Aportes e devoluções de uma pessoa, com "Excluir" em cada um que ela (ou o organizador) pode apagar. */
export function MemberPoolSheet({ userId, onClose, onAdd }: { userId: string; onClose: () => void; onAdd?: () => void }) {
  const { bundle: b, me, profileOf, isOrganizer, canEdit } = useBundle();
  const { online } = useAuth();
  const { remove, busy } = useDeleteContribution();
  const status = memberPoolStatus(b).find((m) => m.userId === userId);
  const list = b.poolContributions.filter((c) => c.user_id === userId).sort((x, y) => y.contributed_on.localeCompare(x.contributed_on) || y.created_at.localeCompare(x.created_at));
  const money = (v: number) => formatMoney(v, b.trip.base_currency);
  const name = profileOf(userId)?.display_name ?? 'Pessoa';
  const mayAdd = canEdit && (isOrganizer || userId === me);
  return <Sheet open title={userId === me ? 'Seus aportes' : `Aportes de ${name}`} description={status ? `${money(status.depositedCents)} de ${money(status.targetCents)}` : undefined} onClose={onClose}
    footer={mayAdd && onAdd ? <Button variant="secondary" icon="plus" onClick={onAdd}>Registrar aporte</Button> : undefined}>
    <div className={s.form}>
      {!online ? <p>Precisa de internet para excluir.</p> : null}
      {list.length ? <ul className={s.poolList} aria-label="Movimentos no caixa">{list.map((c) => {
        const can = canDeleteContribution(c, { me, isOrganizer, canEdit });
        return <li key={c.id} className={s.item}>
          <span><b>{c.kind === 'deposit' ? 'Aporte' : 'Devolução'} · {money(c.amount_cents)}</b><small>{dateBr(c.contributed_on)}{c.note ? ` · ${c.note}` : ''}{c.created_by && c.created_by !== c.user_id ? ` · lançado por ${profileOf(c.created_by)?.display_name ?? 'outra pessoa'}` : ''}</small></span>
          {can ? <Button variant="ghost" size="sm" className={s.danger} disabled={busy || !online} aria-label={`Excluir ${c.kind === 'deposit' ? 'aporte' : 'devolução'} de ${money(c.amount_cents)} em ${dateBr(c.contributed_on)}`} onClick={() => void remove(c)}>Excluir</Button> : null}
        </li>;
      })}</ul> : <p className={s.muted}>Nenhum aporte ainda.</p>}
      {list.some((c) => !canDeleteContribution(c, { me, isOrganizer, canEdit })) ? <p className={s.muted}>Só quem organiza a trilha exclui aportes lançados por outra pessoa.</p> : null}
    </div>
  </Sheet>;
}

export function ContributionSheet({ entry, userId, onClose }: { entry?: PoolContribution; userId?: string; onClose: () => void }) {
  const { bundle: b, me, source, reload, profileOf, isOrganizer, canEdit } = useBundle();
  const { online } = useAuth();
  const { run, busy } = useAction();
  const del = useDeleteContribution();
  const [who, setWho] = useState(entry?.user_id ?? (isOrganizer ? userId : null) ?? me);
  const [value, setValue] = useState<number | null>(entry?.amount_cents ?? null);
  const [kind, setKind] = useState<'deposit' | 'refund'>(entry?.kind ?? 'deposit');
  const [date, setDate] = useState(entry?.contributed_on ?? todayIn(b.trip.departure_tz));
  const [note, setNote] = useState(entry?.note ?? '');
  const quick = poolQuickAmounts(memberPoolStatus(b).find((m) => m.userId === who));
  const proposed = { id: 'preview', trip_id: b.trip.id, user_id: who, kind, amount_cents: value ?? 0, contributed_on: date, note, created_by: me, created_at: new Date().toISOString() };
  const preview = { ...b, poolContributions: [...b.poolContributions.filter((x) => x.id !== entry?.id), proposed] };
  const after = memberPoolStatus(preview).find((m) => m.userId === who);
  const canDelete = !!entry && canDeleteContribution(entry, { me, isOrganizer, canEdit });
  const valid = canEdit && online && !entry && !!date && value != null && value > 0 && value <= 100000000000 && (isOrganizer || who === me && kind === 'deposit');
  const money = (v: number) => formatMoney(v, b.trip.base_currency);
  return <Sheet open title={entry ? 'Movimento do caixa' : 'Aporte no caixa'} onClose={onClose} footer={<>
    {entry && canDelete ? <Button variant="ghost" className={s.danger} disabled={del.busy || !online} onClick={() => void del.remove(entry, onClose)}>Excluir</Button> : null}
    {!entry ? <Button disabled={!valid || busy} onClick={() => void run(async () => { if (!valid) return; await source.insert('pool_contributions', { trip_id: b.trip.id, user_id: who, kind, amount_cents: value, contributed_on: date, note: note.trim() || null }, { returning: false }); await reload(); onClose(); }, { success: kind === 'deposit' ? 'Aporte registrado.' : 'Devolução registrada.' })}>Salvar {kind === 'deposit' ? 'aporte' : 'devolução'}</Button> : null}
  </>}><div className={s.form}>
    {!online ? <p>Precisa de internet para salvar.</p> : null}
    {entry ? <p className={s.note}>Movimentos do caixa não são editados. Para corrigir, exclua e registre novamente.</p> : null}
    <fieldset><legend>Quem</legend><div className={s.chips}>{b.members.filter((m) => isOrganizer || m.user_id === who).map((m) => <Chip key={m.user_id} disabled={!!entry} selected={who === m.user_id} onClick={() => setWho(m.user_id)}>{profileOf(m.user_id)?.display_name ?? 'Pessoa'}</Chip>)}</div></fieldset>
    {entry ? <strong>{money(entry.amount_cents)}</strong> : <><MoneyInput label="Valor do aporte" currency={b.trip.base_currency} value={value} onChange={setValue} autoFocus />{quick && kind === 'deposit' ? <div className={s.chips}><Chip onClick={() => setValue(quick.missing)}>O que falta ({money(quick.missing)})</Chip><Chip onClick={() => setValue(quick.half)}>Metade ({money(quick.half)})</Chip><Chip onClick={() => setValue(null)}>Outro</Chip></div> : null}</>}
    <div className={s.chips}><Chip selected={kind === 'deposit'} disabled={!!entry} onClick={() => setKind('deposit')}>Aporte</Chip>{isOrganizer || kind === 'refund' ? <Chip selected={kind === 'refund'} disabled={!!entry} onClick={() => setKind('refund')}>Devolução</Chip> : null}</div>
    <Field label="Data"><input type="date" disabled={!!entry} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
    <Field label="Nota (opcional)"><input maxLength={300} disabled={!!entry} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Pix 12/11" /></Field>
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
  }, { success: 'Cotas atualizadas.' })}>Salvar cotas</Button>}><div className={s.form}><p>Deixe vazio para dividir o planejado igualmente. Zero significa que a pessoa não tem cota.</p>{b.members.map((m) => <Field key={m.user_id} label={<>{profileOf(m.user_id)?.display_name} ({b.trip.base_currency})</>}><input inputMode="decimal" value={values[m.user_id]} placeholder="Igual para todos" onChange={(e) => setValues({ ...values, [m.user_id]: e.target.value })} /></Field>)}<Button variant="secondary" onClick={() => setValues(Object.fromEntries(b.members.map((m) => [m.user_id, ''])))}>Todos iguais</Button></div></Sheet>;
}
