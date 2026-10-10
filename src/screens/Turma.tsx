'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Dialog, useAction, useConfirm, useToast } from '../components/ui/feedback';
import { Avatar, Floaters, Icon, MotifCheck, PageTitle, useReveal } from '../components/ui/primitives';
import { useAuth } from '../data/AuthContext';
import { useBundle } from '../data/TripContext';
import type { Invite, Poll, PollOption, PollTarget, Role } from '../data/types';
import { sortedStops } from '../lib/derive';
import { track } from '../lib/analytics';
import { SITE_URL } from '../lib/env';
import { dayMonth, initials, MONTHS, pad2, plural, ROLE_LABEL } from '../lib/format';
import { fgOn } from '../lib/identity/contrast';
import { colorCycle } from '../lib/identity/theme';
import { formatMoney, toCents } from '../lib/money';
import { canDecide, myVotes, optionsOf, pollState, pollWinners, tallyPoll, votersCount } from '../lib/polls';
import { getSupabase } from '../lib/supabase/client';
import { dateRange, instantToWall, wallToInstant } from '../lib/time';
import t from './turma.module.css';

export default function Turma() {
  const { bundle: b, identity, isOrganizer, source, reload, me, profileOf } = useBundle();
  const { refreshTrips } = useAuth();
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const toast = useToast();
  const cols = colorCycle(identity);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [link, setLink] = useState<string | null>(null);
  const [role, setRole] = useState<Exclude<Role, 'organizer'>>('editor');
  const [hours, setHours] = useState(168);
  const [uses, setUses] = useState(5);
  useReveal([b.members.length]);

  const loadInvites = useCallback(async () => {
    const sb = getSupabase();
    if (!sb || !isOrganizer || source.kind !== 'supabase') return;
    const r = await sb.from('trip_invites').select('id,trip_id,role,created_by,expires_at,max_uses,uses,revoked_at,created_at').eq('trip_id', b.trip.id).order('created_at', { ascending: false });
    if (!r.error) setInvites(r.data as Invite[]);
  }, [b.trip.id, isOrganizer, source.kind]);
  useEffect(() => {
    void loadInvites();
  }, [loadInvites]);

  const create = () =>
    run(async () => {
      const token = await source.rpc<string>('create_invite', { p_trip: b.trip.id, p_role: role, p_hours: hours, p_max_uses: uses });
      // Token no fragmento (#): não vai para logs de servidor nem cabeçalho Referer.
      const origin = SITE_URL || window.location.origin;
      setLink(`${origin}/convite/aceitar#${token}`);
      await loadInvites();
    }, { success: 'Convite criado. Copie o link agora: ele não é mostrado de novo.' });

  const revoke = (i: Invite) =>
    run(async () => {
      const sb = getSupabase()!;
      const r = await sb.from('trip_invites').update({ revoked_at: new Date().toISOString() }).eq('id', i.id);
      if (r.error) throw r.error;
      await loadInvites();
    }, { success: 'Convite revogado.' });

  const changeRole = (uid: string, r: Role) => run(() => source.updateWhere('trip_members', { trip_id: b.trip.id, user_id: uid }, { role: r }).then(reload), { success: 'Papel atualizado.' });
  const removeMember = async (uid: string) => {
    const self = uid === me;
    const ok = await confirm({
      title: self ? 'Sair da trilha?' : `Remover ${profileOf(uid)?.display_name ?? 'pessoa'}?`,
      message: self ? 'Você perde o acesso a esta trilha neste e em outros aparelhos.' : 'A pessoa perde o acesso imediatamente. Cópias já baixadas num aparelho desconectado só somem quando ele voltar a sincronizar; não dá pra apagar remotamente um aparelho offline.',
      confirmLabel: self ? 'Sair' : 'Remover',
    });
    if (!ok) return;
    await run(async () => {
      await source.remove('trip_members', { trip_id: b.trip.id, user_id: uid });
      if (self) {
        await refreshTrips();
        window.location.href = '/';
      } else await reload();
    });
  };

  const now = Date.now();
  return (
    <div className="wrap">
      <Floaters />
      <PageTitle eyebrow={b.trip.title} title="Turma" sub="Quem viaja junto. Organizador administra; editores mexem no conteúdo; leitores consultam e votam." />
      <section className="split">
        <div className="col-side" style={{ gap: 12 }}>
          {b.members.map((m, i) => {
            const p = profileOf(m.user_id);
            const c = cols[i % 3];
            return (
              <div key={m.user_id} className="card rv" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, borderRadius: 22, flexWrap: 'wrap' }}>
                <span className="av" style={{ width: 42, height: 42, background: c, color: fgOn(c) }}>{initials(p?.display_name ?? '?')}</span>
                <span style={{ flex: 1, fontWeight: 600 }}>{p?.display_name ?? 'Pessoa'}{m.user_id === me ? ' (você)' : ''}</span>
                {isOrganizer && m.user_id !== me ? (
                  <select aria-label={`Papel de ${p?.display_name}`} value={m.role} disabled={busy} onChange={(e) => void changeRole(m.user_id, e.target.value as Role)} style={{ minHeight: 40, borderRadius: 12, border: '1px solid var(--line)', background: 'var(--bg)' }}>
                    <option value="organizer">Organiza</option>
                    <option value="editor">Pode editar</option>
                    <option value="viewer">Só consulta</option>
                  </select>
                ) : <span className="mono" style={{ fontSize: 12, color: 'var(--mute)' }}>{ROLE_LABEL[m.role]}</span>}
                {(isOrganizer && m.user_id !== me) || m.user_id === me ? (
                  <button className="btn btn-sm btn-danger tap" onClick={() => void removeMember(m.user_id)}>{m.user_id === me ? 'Sair' : 'Remover'}</button>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="col-main" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Decisions />
          {source.kind === 'demo' ? (
            <div className="empty"><h2 className="disp">Convites na trilha real</h2><p style={{ margin: 0 }}>Na demonstração não dá pra convidar. Crie uma trilha para chamar a turma.</p></div>
          ) : isOrganizer ? (
            <article className="card rv" style={{ padding: 26, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <h2 className="disp" style={{ margin: 0, fontSize: 26 }}>Convidar</h2>
              <div className="grid2">
                <label className="field">Papel<select value={role} onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}><option value="editor">Pode editar</option><option value="viewer">Só consulta</option></select></label>
                <label className="field">Validade<select value={hours} onChange={(e) => setHours(Number(e.target.value))}><option value={24}>1 dia</option><option value={72}>3 dias</option><option value={168}>7 dias</option><option value={720}>30 dias</option></select></label>
                <label className="field">Usos<input type="number" min={1} max={100} value={uses} onChange={(e) => setUses(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} /></label>
              </div>
              <button className="btn btn-primary tap" style={{ alignSelf: 'flex-start' }} onClick={create} disabled={busy}><Icon name="plus" size={18} />Gerar link de convite</button>
              {link ? (
                <label className="field">Link (aparece só agora)
                  <span style={{ display: 'flex', gap: 8 }}>
                    <input readOnly value={link} onFocus={(e) => e.target.select()} style={{ flex: 1, minWidth: 0 }} />
                    <button className="btn btn-icon tap" aria-label="Copiar link" onClick={async () => { try { await navigator.clipboard.writeText(link); toast('Link copiado.'); } catch { toast('Copie manualmente.'); } }}><Icon name="link" size={20} /></button>
                  </span>
                  <span className="hint">Quem abrir precisa entrar na conta. Saber o endereço da trilha não dá acesso: só o convite válido.</span>
                </label>
              ) : null}
              {invites.length ? (
                <div>
                  <h3 className="h3">Convites</h3>
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {invites.map((i) => {
                      const expired = Date.parse(i.expires_at) <= now;
                      const status = i.revoked_at ? 'REVOGADO' : expired ? 'EXPIRADO' : i.uses >= i.max_uses ? 'ESGOTADO' : 'ATIVO';
                      return (
                        <li key={i.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 12px', borderRadius: 14, background: 'var(--bg)', flexWrap: 'wrap' }}>
                          <span className="pill" data-tone={status === 'ATIVO' ? 'acc2' : undefined}>{status}</span>
                          <span style={{ flex: 1, fontSize: 14 }}>{ROLE_LABEL[i.role]} · {i.uses}/{i.max_uses} usos · até {new Date(i.expires_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                          {status === 'ATIVO' ? <button className="btn btn-sm tap" onClick={() => void revoke(i)}>Revogar</button> : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </article>
          ) : (
            <div className="empty"><h2 className="disp">Convites</h2><p style={{ margin: 0 }}>Só quem organiza a trilha cria e revoga convites.</p></div>
          )}
        </div>
      </section>
    </div>
  );
}

// ───────────────────────── Decisões (ref/SPEC-votacao.md §6.2) ─────────────────────────

const TARGET_LABEL: Record<PollTarget, string> = { stay: 'HOSPEDAGEM', activity: 'PASSEIO', free: 'LIVRE' };

/** "ATÉ 18 JAN 23:59" no fuso da partida. */
function deadlineLabel(iso: string, tz: string): string {
  const w = instantToWall(tz, Date.parse(iso));
  return `ATÉ ${w.d} ${MONTHS[w.mo - 1].toUpperCase()} ${pad2(w.h)}:${pad2(w.mi)}`;
}

function priceLabel(o: PollOption): string | null {
  return o.price != null && o.currency ? formatMoney(toCents(o.price), o.currency) : null;
}

function Decisions() {
  const { bundle: b, canEdit } = useBundle();
  const [creating, setCreating] = useState(false);
  const now = Date.now();
  const polls = b.polls ?? [];
  const deadline = (p: Poll) => (p.closes_at ? Date.parse(p.closes_at) : Infinity);
  const open = polls.filter((p) => pollState(b, p.id, now) === 'open').sort((x, y) => deadline(x) - deadline(y));
  const awaiting = polls.filter((p) => pollState(b, p.id, now) === 'awaiting_decision').sort((x, y) => deadline(x) - deadline(y));
  const closed = polls.filter((p) => p.status === 'closed').sort((x, y) => (y.decided_at ?? '').localeCompare(x.decided_at ?? ''));
  return (
    <section id="decisoes" className={t.decisions} aria-labelledby="decisoes-titulo">
      <div className={t.head}>
        <h2 id="decisoes-titulo" className="disp" style={{ margin: 0, fontSize: 30 }}>Decisões</h2>
        {canEdit ? <button className="btn btn-primary tap" onClick={() => setCreating(true)}><Icon name="plus" size={18} />Nova votação</button> : null}
      </div>
      {!open.length && !awaiting.length ? (
        <p className="muted" style={{ margin: 0 }}>Nada pra decidir agora. Quando tiver dúvida entre opções, abre uma votação.</p>
      ) : null}
      {[...open, ...awaiting].map((p) => <PollCard key={p.id} poll={p} />)}
      {closed.length ? (
        <details className={t.closed}>
          <summary>Encerradas ({closed.length})</summary>
          <div className={t.closedList}>{closed.map((p) => <PollCard key={p.id} poll={p} />)}</div>
        </details>
      ) : null}
      {creating ? <NewPollDialog onClose={() => setCreating(false)} /> : null}
    </section>
  );
}

function PollCard({ poll }: { poll: Poll }) {
  const { bundle: b, identity, me, role, isOrganizer, source, reload, profileOf, base } = useBundle();
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const cols = colorCycle(identity);
  const state = pollState(b, poll.id);
  const options = optionsOf(b, poll.id);
  const tally = new Map(tallyPoll(b, poll.id).map((r) => [r.optionId, r]));
  const { voted, total } = votersCount(b, poll.id);
  const mine = myVotes(b, poll.id, me);
  const [sel, setSel] = useState<string[]>(mine);
  const [deciding, setDeciding] = useState(false);
  const [editing, setEditing] = useState(false);
  const mineKey = [...mine].sort().join();
  useEffect(() => setSel(mineKey ? mineKey.split(',') : []), [mineKey]);

  const stop = poll.stop_id ? b.stops.find((s) => s.id === poll.stop_id) ?? null : null;
  const name = (uid: string | null) => (uid && profileOf(uid)?.display_name) || 'Ex-membro';
  const creatorIn = b.members.some((m) => m.user_id === poll.created_by);
  const decider = creatorIn ? name(poll.created_by) : 'O organizador';
  const mayDecide = canDecide(b, poll, me);
  const mayManage = poll.status === 'open' && (poll.created_by === me || isOrganizer);
  const canVote = !!role && state === 'open';
  const max = Math.max(1, ...options.map((o) => tally.get(o.id)?.votes ?? 0));
  const winner = poll.decided_option_id;
  const created = poll.target === 'stay' ? b.stays.find((s) => s.from_poll_id === poll.id) : poll.target === 'activity' ? b.activities.find((a) => a.from_poll_id === poll.id) : undefined;
  const changed = [...sel].sort().join() !== mineKey;
  const groupName = `poll-${poll.id}`;

  const vote = (options: string[], success: string) => run(async () => {
    await source.rpc('cast_vote', { p_poll: poll.id, p_options: options });
    if (options.length && source.kind === 'supabase') track('poll.voted', {}, b.trip.id);
    await reload();
  }, { success });
  const toggle = (id: string, on: boolean) => setSel(poll.multi ? (on ? [...sel, id] : sel.filter((x) => x !== id)) : on ? [id] : []);
  const del = async () => {
    if (!(await confirm({ title: 'Excluir votação?', message: 'A pergunta, as opções e os votos somem para toda a turma.' }))) return;
    await run(() => source.remove('polls', { id: poll.id }).then(reload), { success: 'Votação excluída.' });
  };

  return (
    <article className={`card ${t.poll}`} aria-labelledby={`q-${poll.id}`}>
      <div className={`${t.meta} mono`}>
        <span className="pill" data-tone={poll.target === 'free' ? undefined : 'acc2'}>{TARGET_LABEL[poll.target]}{stop ? ` · ${stop.name.toUpperCase()}` : ''}</span>
        {poll.status === 'open' && poll.closes_at ? <span>{deadlineLabel(poll.closes_at, b.trip.departure_tz)}</span> : null}
        {poll.multi ? <span>VÁRIAS OPÇÕES</span> : null}
        <span>{voted} de {total} votaram</span>
      </div>
      <h3 id={`q-${poll.id}`} className={`disp ${t.question}`}>{poll.question}</h3>
      {poll.detail ? <p style={{ margin: 0, overflowWrap: 'anywhere' }}>{poll.detail}</p> : null}
      {state === 'awaiting_decision' ? <p className={t.warn}>Prazo encerrado. {decider} decide.</p> : null}

      <ul className={t.options} role={poll.multi ? undefined : 'radiogroup'} aria-labelledby={`q-${poll.id}`}>
        {options.map((o, i) => {
          const r = tally.get(o.id);
          const votes = r?.votes ?? 0;
          const price = priceLabel(o);
          return (
            <li key={o.id} className={t.option} data-win={winner === o.id}>
              {poll.status === 'open' ? (
                <MotifCheck className={t.pick} type={poll.multi ? 'checkbox' : 'radio'} name={groupName} label={o.label} checked={sel.includes(o.id)} disabled={!canVote || busy} onChange={(on) => toggle(o.id, on)}>
                  <span className="mono" style={{ fontSize: 12 }}>{plural(votes, 'voto', 'votos')}</span>
                </MotifCheck>
              ) : (
                <div className={t.optRow} style={{ minHeight: 32 }}>
                  <b style={{ flex: 1, overflowWrap: 'anywhere' }}>{winner === o.id ? '✓ ' : ''}{o.label}</b>
                  {winner === o.id ? <span className="pill" data-tone="acc">ESCOLHIDA</span> : null}
                  <span className="mono" style={{ fontSize: 12 }}>{plural(votes, 'voto', 'votos')}</span>
                </div>
              )}
              {o.detail ? <p className={t.optText}>{o.detail}</p> : null}
              {price || o.link_url || o.address ? (
                <div className={t.optRow}>
                  {price ? <span className="mono">{price}</span> : null}
                  {o.address ? <span className={t.optText}>{o.address}</span> : null}
                  {o.link_url ? <a href={o.link_url} target="_blank" rel="noopener noreferrer nofollow">Ver link<span className="sr-only"> de {o.label} (abre em nova aba)</span></a> : null}
                </div>
              ) : null}
              <div className={t.bar} aria-hidden="true"><i data-zero={votes === 0} style={{ width: `${(votes / max) * 100}%`, background: cols[i % 4] }} /></div>
              {r?.voters.length ? (
                <div className={t.voters} aria-label={`Votaram: ${r.voters.map(name).join(', ')}`}>
                  {r.voters.map((uid, j) => <Avatar key={uid} name={name(uid)} color={cols[(j + 1) % 4]} size={24} />)}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className={t.actions}>
        {canVote ? (
          <>
            {mine.length === 0 || changed ? (
              <button className="btn btn-primary tap" disabled={busy || !sel.length || !changed} onClick={() => void vote(sel, 'Voto registrado.')}>{mine.length ? 'Mudar voto' : 'Votar'}</button>
            ) : null}
            {mine.length ? <button className="btn tap" disabled={busy} onClick={() => void vote([], 'Voto retirado.')}>Retirar voto</button> : null}
          </>
        ) : null}
        {poll.status === 'open' && mayDecide ? <button className={`btn tap ${state === 'awaiting_decision' ? 'btn-primary' : ''}`} onClick={() => setDeciding(true)}>Decidir</button> : null}
        {mayManage ? (
          <>
            <button className="btn btn-sm tap" onClick={() => setEditing(true)}><Icon name="edit" size={16} />Editar</button>
            <button className="btn btn-sm btn-danger tap" disabled={busy} onClick={() => void del()}>Excluir</button>
          </>
        ) : null}
      </div>

      {poll.status === 'closed' ? (
        <p className="mono" style={{ margin: 0, fontSize: 12 }}>
          Decidido por {name(poll.decided_by)} em {poll.decided_at ? dayMonth(poll.decided_at.slice(0, 10)) : ''}
          {created && stop ? <> · <Link href={`${base}/roteiro?parada=${stop.id}`}>{poll.target === 'stay' ? 'Ver hospedagem no roteiro' : 'Ver no roteiro'}</Link></> : null}
        </p>
      ) : null}
      {deciding ? <DecideDialog poll={poll} onClose={() => setDeciding(false)} /> : null}
      {editing ? <EditPollDialog poll={poll} onClose={() => setEditing(false)} /> : null}
    </article>
  );
}

function DecideDialog({ poll, onClose }: { poll: Poll; onClose: () => void }) {
  const { bundle: b, source, reload } = useBundle();
  const { run, busy } = useAction();
  const toast = useToast();
  const options = optionsOf(b, poll.id);
  const tally = new Map(tallyPoll(b, poll.id).map((r) => [r.optionId, r.votes]));
  const winners = pollWinners(b, poll.id);
  const stop = poll.stop_id ? b.stops.find((s) => s.id === poll.stop_id) ?? null : null;
  const days = stop ? dateRange(stop.arrival_date, stop.departure_date) : [];
  const [choice, setChoice] = useState(winners[0] ?? options[0]?.id ?? '');
  const [day, setDay] = useState(days[0] ?? '');
  const [apply, setApply] = useState(true);
  const label = (id: string) => options.find((o) => o.id === id)?.label ?? '';
  const appliable = poll.target !== 'free' && !!stop;

  const save = async () => {
    const r = await run(async () => {
      const res = await source.rpc<{ applied: boolean; reason: string | null }>('close_poll', {
        p_poll: poll.id, p_option: choice, p_day: poll.target === 'activity' && apply ? day || null : null, p_apply: appliable && apply,
      });
      await reload();
      return res;
    });
    if (!r) return;
    if (source.kind === 'supabase') track('poll.closed', { applied: r.applied, tie: winners.length > 1 }, b.trip.id);
    if (r.reason === 'stay_booked') toast(`Decidido. ${stop?.name ?? 'A parada'} já tem hospedagem reservada, então nada foi trocado.`);
    else if (r.applied) toast(poll.target === 'stay' ? `Decidido. ${label(choice)} virou a hospedagem de ${stop?.name}.` : `Decidido. ${label(choice)} foi pro roteiro de ${stop?.name}.`);
    else toast('Decidido.');
    onClose();
  };

  return (
    <Dialog open onClose={onClose} title="Decidir" footer={<>
      <button className="btn tap" onClick={onClose}>Cancelar</button>
      <button className="btn btn-primary tap" disabled={busy || !choice} onClick={() => void save()}>{busy ? 'Salvando…' : 'Confirmar decisão'}</button>
    </>}>
      <p style={{ margin: 0 }}><b>{poll.question}</b></p>
      {winners.length > 1 ? <p className={t.warn}>Empate entre {winners.map(label).join(' e ')}. Você desempata.</p> : null}
      <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <legend className="sr-only">Opção escolhida</legend>
        {options.map((o) => (
          <MotifCheck key={o.id} className={t.pick} type="radio" name={`decide-${poll.id}`} label={o.label} checked={choice === o.id} onChange={(on) => on && setChoice(o.id)}>
            <span className="mono" style={{ fontSize: 12 }}>{plural(tally.get(o.id) ?? 0, 'voto', 'votos')}</span>
          </MotifCheck>
        ))}
      </fieldset>
      {winners.length && !winners.includes(choice) ? <p className={t.warn} role="status">Essa não foi a mais votada.</p> : null}
      {appliable ? (
        <MotifCheck className={t.pick} label={poll.target === 'stay' ? `Aplicar no roteiro (vira a hospedagem pendente de ${stop!.name})` : `Aplicar no roteiro (vira atividade em ${stop!.name})`} checked={apply} onChange={setApply} />
      ) : null}
      {appliable && apply && poll.target === 'activity' ? (
        <label className="field">Dia
          <select value={day} onChange={(e) => setDay(e.target.value)}>{days.map((d) => <option key={d} value={d}>{dayMonth(d)}</option>)}</select>
        </label>
      ) : null}
      {appliable && !apply ? <p className="muted" style={{ margin: 0, fontSize: 13 }}>Só registra a decisão; o roteiro fica como está.</p> : null}
    </Dialog>
  );
}

/** Data e hora (parede, no fuso da partida) ↔ instante ISO. */
function splitDeadline(iso: string | null, tz: string): { date: string; time: string } {
  if (!iso) return { date: '', time: '' };
  const w = instantToWall(tz, Date.parse(iso));
  return { date: `${w.y}-${pad2(w.mo)}-${pad2(w.d)}`, time: `${pad2(w.h)}:${pad2(w.mi)}` };
}
function joinDeadline(date: string, time: string, tz: string): string | null {
  if (!date) return null;
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = (time || '23:59').split(':').map(Number);
  return new Date(wallToInstant(tz, { y, mo, d, h, mi, s: 0 })).toISOString();
}

function EditPollDialog({ poll, onClose }: { poll: Poll; onClose: () => void }) {
  const { bundle: b, source, reload } = useBundle();
  const { run, busy } = useAction();
  const tz = b.trip.departure_tz;
  const [v, setV] = useState({ question: poll.question, detail: poll.detail ?? '', ...splitDeadline(poll.closes_at, tz) });
  const ok = v.question.trim().length >= 1 && v.question.trim().length <= 140 && v.detail.length <= 300;
  const patch = () => ({ question: v.question.trim(), detail: v.detail.trim() || null, closes_at: joinDeadline(v.date, v.time, tz) });
  const save = () => run(async () => {
    await source.update('polls', poll.id, patch(), poll.version);
    await reload();
    onClose();
  }, { success: 'Votação atualizada.', onConflict: async () => { await source.update('polls', poll.id, patch()); await reload(); onClose(); } });
  return (
    <Dialog open onClose={onClose} title="Editar votação" footer={<>
      <button className="btn tap" onClick={onClose}>Cancelar</button>
      <button className="btn btn-primary tap" disabled={busy || !ok} onClick={() => void save()}>Salvar</button>
    </>}>
      <label className="field">Pergunta<input value={v.question} maxLength={140} onChange={(e) => setV({ ...v, question: e.target.value })} /></label>
      <label className="field">Detalhe (opcional)<textarea rows={2} value={v.detail} maxLength={300} onChange={(e) => setV({ ...v, detail: e.target.value })} /></label>
      <DeadlineFields date={v.date} time={v.time} onChange={(d) => setV({ ...v, ...d })} />
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>Opções não mudam depois de criadas. O prazo não fecha a votação sozinho: depois dele, quem criou ou o organizador decide.</p>
    </Dialog>
  );
}

function DeadlineFields({ date, time, onChange }: { date: string; time: string; onChange: (v: { date: string; time: string }) => void }) {
  return (
    <div className="grid2">
      <label className="field">Prazo para votar (opcional)<input type="date" value={date} onChange={(e) => onChange({ date: e.target.value, time })} /></label>
      <label className="field">Hora<input type="time" value={time} disabled={!date} onChange={(e) => onChange({ date, time: e.target.value })} /><span className="hint">Sem hora: 23:59.</span></label>
    </div>
  );
}

interface OptDraft { key: string; label: string; detail: string; link_url: string; price: string; currency: string; address: string }
const emptyOpt = (currency: string): OptDraft => ({ key: crypto.randomUUID(), label: '', detail: '', link_url: '', price: '', currency, address: '' });

/** Mesmos limites dos `check` do banco. Retorna a mensagem do primeiro problema. */
function optProblem(o: OptDraft, target: PollTarget): string | null {
  if (!o.label.trim()) return 'Dê um nome à opção.';
  if (o.label.trim().length > 80) return 'Nome com até 80 caracteres.';
  if (o.detail.length > 300) return 'Detalhe com até 300 caracteres.';
  if (o.link_url.trim() && (!/^https?:\/\//.test(o.link_url.trim()) || o.link_url.trim().length > 500)) return 'Use um link http(s).';
  if (o.price.trim()) {
    const n = Number(o.price.replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) return 'Preço inválido.';
    if (!/^[A-Z]{3}$/.test(o.currency)) return 'Moeda com 3 letras (ex.: BRL).';
  }
  if (target === 'stay' && o.address.length > 200) return 'Endereço com até 200 caracteres.';
  return null;
}

function NewPollDialog({ onClose }: { onClose: () => void }) {
  const { bundle: b, source, reload, me } = useBundle();
  const { run, busy } = useAction();
  const stops = sortedStops(b);
  const tz = b.trip.departure_tz;
  const cur = b.trip.base_currency;
  const [v, setV] = useState({ question: '', detail: '', target: 'stay' as PollTarget, stop_id: stops[0]?.id ?? '', multi: false, date: '', time: '' });
  const [opts, setOpts] = useState<OptDraft[]>([emptyOpt(cur), emptyOpt(cur)]);
  const [tried, setTried] = useState(false);
  const needsStop = v.target !== 'free';
  const problems = opts.map((o) => optProblem(o, v.target));
  const qProblem = !v.question.trim() ? 'Escreva a pergunta.' : v.question.trim().length > 140 ? 'Pergunta com até 140 caracteres.' : null;
  const stopProblem = needsStop && !v.stop_id ? 'Escolha a parada.' : null;
  const ok = !qProblem && !stopProblem && v.detail.length <= 300 && opts.length >= 2 && opts.length <= 6 && problems.every((p) => !p);
  const setOpt = (i: number, patch: Partial<OptDraft>) => setOpts(opts.map((o, j) => (j === i ? { ...o, ...patch } : o)));

  const save = async () => {
    setTried(true);
    if (!ok) return;
    const id = crypto.randomUUID();
    const done = await run(async () => {
      await source.insert('polls', {
        id, trip_id: b.trip.id, question: v.question.trim(), detail: v.detail.trim() || null, target: v.target,
        stop_id: needsStop ? v.stop_id : null, multi: v.multi, closes_at: joinDeadline(v.date, v.time, tz), created_by: me,
      }, { returning: false });
      try {
        for (const [i, o] of opts.entries()) {
          const price = o.price.trim() ? Number(o.price.replace(',', '.')).toFixed(2) : null;
          await source.insert('poll_options', {
            id: crypto.randomUUID(), poll_id: id, trip_id: b.trip.id, label: o.label.trim(), detail: o.detail.trim() || null,
            link_url: o.link_url.trim() || null, price, currency: price ? o.currency : null,
            address: v.target === 'stay' ? o.address.trim() || null : null, position: i, created_by: me,
          }, { returning: false });
        }
      } catch (e) {
        await source.remove('polls', { id }).catch(() => undefined); // sem enquete órfã
        throw e;
      }
      if (source.kind === 'supabase') track('poll.created', { target: v.target, options: opts.length }, b.trip.id);
      await reload();
      return true;
    }, { success: 'Votação aberta. A turma já pode votar.' });
    if (done) onClose();
  };

  return (
    <Dialog open onClose={onClose} title="Nova votação" footer={<>
      <button className="btn tap" onClick={onClose}>Cancelar</button>
      <button className="btn btn-primary tap" disabled={busy} onClick={() => void save()}>{busy ? 'Salvando…' : 'Abrir votação'}</button>
    </>}>
      <label className="field">Pergunta<input value={v.question} maxLength={140} onChange={(e) => setV({ ...v, question: e.target.value })} placeholder="Onde a gente dorme em Cusco?" />{tried && qProblem ? <span className="err">{qProblem}</span> : null}</label>
      <label className="field">Detalhe (opcional)<textarea rows={2} value={v.detail} maxLength={300} onChange={(e) => setV({ ...v, detail: e.target.value })} /></label>
      <div className="field">
        <span id="nv-tipo">Tipo</span>
        <div role="group" aria-labelledby="nv-tipo" className={t.types}>
          {(['stay', 'activity', 'free'] as PollTarget[]).map((k) => (
            <button key={k} type="button" className="chip tap" aria-pressed={v.target === k} onClick={() => setV({ ...v, target: k })}>{{ stay: 'Hospedagem', activity: 'Passeio', free: 'Livre' }[k]}</button>
          ))}
        </div>
        <span className="hint">{v.target === 'stay' ? 'A escolhida vira a hospedagem pendente da parada (se ainda não houver reserva).' : v.target === 'activity' ? 'A escolhida vira atividade no roteiro da parada.' : 'Só registra a decisão (ex.: qual cidade, qual data).'}</span>
      </div>
      {needsStop ? (
        <label className="field">Parada
          <select value={v.stop_id} onChange={(e) => setV({ ...v, stop_id: e.target.value })}>
            <option value="">Escolha</option>
            {stops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {tried && stopProblem ? <span className="err">{stopProblem}</span> : null}
        </label>
      ) : null}
      <MotifCheck className={t.pick} label="Cada pessoa pode marcar mais de uma" checked={v.multi} onChange={(multi) => setV({ ...v, multi })} />
      <DeadlineFields date={v.date} time={v.time} onChange={(d) => setV({ ...v, ...d })} />

      <h3 className="h3" style={{ margin: '8px 0 0' }}>Opções ({opts.length} de 6)</h3>
      {opts.map((o, i) => (
        <fieldset key={o.key} className={t.optEdit}>
          <legend className="sr-only">Opção {i + 1}</legend>
          <div className="grid2">
            <label className="field">Opção {i + 1}<input value={o.label} maxLength={80} onChange={(e) => setOpt(i, { label: e.target.value })} /></label>
            <label className="field">Detalhe<input value={o.detail} maxLength={300} onChange={(e) => setOpt(i, { detail: e.target.value })} placeholder="R$ 240 / noite, café incluso" /></label>
          </div>
          <div className="grid2">
            <label className="field">Link<input type="url" value={o.link_url} maxLength={500} placeholder="https://" onChange={(e) => setOpt(i, { link_url: e.target.value })} /></label>
            <div className="grid2">
              <label className="field">Preço<input inputMode="decimal" value={o.price} onChange={(e) => setOpt(i, { price: e.target.value })} /></label>
              <label className="field">Moeda<input value={o.currency} maxLength={3} onChange={(e) => setOpt(i, { currency: e.target.value.toUpperCase() })} /></label>
            </div>
          </div>
          {v.target === 'stay' ? <label className="field">Endereço<input value={o.address} maxLength={200} onChange={(e) => setOpt(i, { address: e.target.value })} /></label> : null}
          {tried && problems[i] ? <span className="err" role="alert" style={{ fontSize: 13 }}>{problems[i]}</span> : null}
          {opts.length > 2 ? <button type="button" className="btn btn-sm tap" style={{ alignSelf: 'flex-start' }} onClick={() => setOpts(opts.filter((_, j) => j !== i))}>Remover opção {i + 1}</button> : null}
        </fieldset>
      ))}
      {opts.length < 6 ? <button type="button" className="btn btn-sm tap" style={{ alignSelf: 'flex-start' }} onClick={() => setOpts([...opts, emptyOpt(cur)])}><Icon name="plus" size={16} />Adicionar opção</button> : null}
    </Dialog>
  );
}
