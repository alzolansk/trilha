'use client';
// TurmaHub (planning §5.7 · Turma.dc.html): membros, decidir juntos, documentos, mala da turma e diário.
// Votos, Documentos, Mala e Diário vivem nas subtelas /turma/*.
import { headcount } from '../lib/people';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useAction, useConfirm, useToast } from '../components/ui/feedback';
import { Sheet } from '../components/ui/Sheet';
import { Avatar, Icon } from '../components/ui/primitives';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { ListRow } from '../components/ui/ListRow';
import { Progress } from '../components/ui/Progress';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { useAuth } from '../data/AuthContext';
import { useBundle } from '../data/TripContext';
import type { DocCategory, Invite, Poll, Role, TripBundle } from '../data/types';
import { packingProgress } from '../lib/derive';
import { SITE_URL } from '../lib/env';
import { dayMonth, plural, ROLE_LABEL } from '../lib/format';
import { memberPoolStatus } from '../lib/money';
import { myVotes, optionsOf, pollState, tallyPoll, votersCount, pollWinners } from '../lib/polls';
import { getSupabase } from '../lib/supabase/client';
import t from './turma.module.css';
import { Field, FieldGrid } from '../components/ui';

/** Documentos esperados por viagem (planning §5.7). Vacina só entraria com regra de fonte oficial (SPEC §9.1): fica de fora. */
export const DOC_COLUMNS: { cat: DocCategory; label: string }[] = [
  { cat: 'identidade', label: 'Passaporte / RG' },
  { cat: 'passagem', label: 'Passagens' },
  { cat: 'seguro', label: 'Seguro' },
];

/** Quem tem cada documento. Documento privado só aparece para quem pode vê-lo (RLS): para os outros conta como "—". */
export function docMatrix(b: Pick<TripBundle, 'documents' | 'members'>): { cat: DocCategory; label: string; has: Map<string, boolean>; missing: number }[] {
  return DOC_COLUMNS.map((c) => {
    const has = new Map<string, boolean>();
    for (const m of b.members) has.set(m.user_id, b.documents.some((d) => d.owner_id === m.user_id && d.category === c.cat && d.status === 'ready'));
    return { ...c, has, missing: b.members.filter((m) => !has.get(m.user_id)).length };
  });
}

/** Pendência principal da pessoa: voto, documento ou aporte (ordem do planning). `null` = em dia. */
export function memberPending(b: TripBundle, uid: string, now = Date.now()): string | null {
  const openPolls = (b.polls ?? []).filter((p) => pollState(b, p.id, now) === 'open');
  if (openPolls.some((p) => myVotes(b, p.id, uid).length === 0)) return 'Falta votar';
  if (!docMatrix(b)[0].has.get(uid)) return 'Falta documento';
  if (memberPoolStatus(b, now).find((m) => m.userId === uid)?.status === 'atrasado') return 'Aporte atrasado';
  return null;
}

export default function Turma() {
  const { bundle: b, isOrganizer, canEdit, me, profileOf, base } = useBundle();
  const [member, setMember] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const packed = packingProgress(b);
  const now = Date.now();
  const polls = b.polls ?? [];
  const deadline = (p: Poll) => (p.closes_at ? Date.parse(p.closes_at) : Infinity);
  const open = polls.filter((p) => pollState(b, p.id, now) === 'open').sort((x, y) => deadline(x) - deadline(y));
  const awaiting = polls.filter((p) => pollState(b, p.id, now) === 'awaiting_decision');
  const pending = [...open, ...awaiting];
  const matrix = docMatrix(b);
  const missingDocs = matrix.reduce((n, c) => n + c.missing, 0);
  const entries = [...b.journalEntries].sort((a, c) => (c.entry_date ?? '').localeCompare(a.entry_date ?? '')).slice(0, 2);

  return (
    <div className="wrap">
      <ScreenHeader title="Turma" subtitle={headcount(b) > b.members.length ? `${headcount(b)} pessoas na viagem · ${b.members.length} no app` : 'Quem viaja junto e o que falta decidir.'} action={canEdit ? <Button size="sm" onClick={() => setInviting(true)}><Icon name="plus" size={16} />Convidar</Button> : null} />

      <section aria-label="Membros" className={t.members}>
        {b.members.map((m) => {
          const p = profileOf(m.user_id);
          const name = p?.display_name ?? 'Pessoa';
          const pend = memberPending(b, m.user_id, now);
          const body = (
            <>
              <Avatar name={name} color={p?.color} me={m.user_id === me} size={44} />
              <b className={t.mName}>{name}{m.user_id === me ? ' (você)' : ''}</b>
              <span className={t.mPend} data-ok={!pend}>{pend ?? 'em dia'}</span>
            </>
          );
          return isOrganizer || m.user_id === me ? (
            <button key={m.user_id} type="button" className={t.member} onClick={() => setMember(m.user_id)} aria-label={`Abrir ${name}`}>{body}</button>
          ) : <div key={m.user_id} className={t.member}>{body}</div>;
        })}
      </section>

      <section aria-labelledby="t-decidir" className={t.block}>
        <div className={t.blockHead}>
          <h2 id="t-decidir" className="disp">Decidir juntos</h2>
          <Link href={`${base}/turma/votos`} className={t.seeAll}>Ver todas ({open.length + awaiting.length})</Link>
        </div>
        {pending.length ? (
          <>
            <TopPoll poll={pending[0]} />
            {pending.slice(1).map((p) => {
              const { voted, total } = votersCount(b, p.id);
              return <ListRow key={p.id} icon="check" title={p.question} subtitle={`${voted} de ${total} votaram`} href={`${base}/turma/votos`} />;
            })}
          </>
        ) : <p className="muted" style={{ margin: 0 }}>Nada pra decidir agora. Quando tiver dúvida entre opções, abra uma votação.</p>}
      </section>

      <section aria-labelledby="t-docs" className={t.block}>
        <div className={t.blockHead}>
          <h2 id="t-docs" className="disp">Documentos</h2>
          <Badge tone={missingDocs ? 'warn' : 'ok'}>{missingDocs ? `faltam ${missingDocs}` : 'completo'}</Badge>
        </div>
        <Link href={`${base}/turma/documentos`} className={t.matrixLink} aria-label="Abrir documentos da turma">
          <div className={t.matrix} role="table" aria-label="Documentos por pessoa" style={{ gridTemplateColumns: `minmax(0,1.4fr) repeat(${b.members.length}, minmax(34px,1fr))` }}>
            <span role="row" style={{ display: 'contents' }}>
              <span role="columnheader" className="sr-only">Documento</span>
              {b.members.map((m) => <span role="columnheader" key={m.user_id} className={t.mHead}><Avatar name={profileOf(m.user_id)?.display_name ?? '?'} color={profileOf(m.user_id)?.color} size={24} /></span>)}
            </span>
            {matrix.map((row) => (
              <span role="row" key={row.cat} style={{ display: 'contents' }}>
                <span role="rowheader" className={t.mLabel}>{row.label}</span>
                {b.members.map((m) => {
                  const ok = row.has.get(m.user_id);
                  return <span role="cell" key={m.user_id} className={t.cell} data-ok={ok} aria-label={`${profileOf(m.user_id)?.display_name ?? 'Pessoa'}: ${ok ? 'tem' : 'falta'}`}>{ok ? '✓' : '—'}</span>;
                })}
              </span>
            ))}
          </div>
        </Link>
        <p className={t.note}><Icon name="lock" size={14} /> Criptografados e disponíveis sem internet.</p>
      </section>

      <section aria-labelledby="t-mala" className={t.block}>
        <div className={t.blockHead}>
          <h2 id="t-mala" className="disp">Mala da turma</h2>
          <Link href={`${base}/turma/mala`} className={t.seeAll} aria-label="Abrir a mala">Abrir</Link>
        </div>
        <Progress value={packed.total ? packed.done / packed.total : 0} label={`${packed.done} de ${packed.total} itens na mochila`} />
        <p className={t.note} style={{ margin: 0 }}>{packed.done} de {packed.total} prontos</p>
        <WhoBrings />
      </section>

      <section aria-labelledby="t-diario" className={t.block}>
        <div className={t.blockHead}>
          <h2 id="t-diario" className="disp">Diário</h2>
          <Link href={`${base}/turma/diario`} className={t.seeAll} aria-label="Abrir o diário">Abrir</Link>
        </div>
        {entries.length ? (
          <div className={t.diary}>
            {entries.map((e) => (
              <Link key={e.id} href={`${base}/turma/diario`} className={t.entry}>
                <span className={t.eyebrow}>{e.kind === 'inspiracao' ? 'INSPIRAÇÃO' : 'REGISTRO'}{e.entry_date ? ` · ${dayMonth(e.entry_date)}` : ''}</span>
                <b>{e.title || e.place_name || 'Sem título'}</b>
              </Link>
            ))}
          </div>
        ) : <p className="muted" style={{ margin: 0 }}>Inspirações e registros da viagem aparecem aqui.</p>}
      </section>

      <nav aria-label="Da trilha" className={t.hub}>
        {canEdit ? <ListRow icon="settings" title="Ajustes da trilha" subtitle="Datas, destino, moeda e aparência" href={`${base}/ajustes`} /> : null}
        <ListRow icon="users" title="Conta" subtitle="Notificações e cofre" href="/conta" />
      </nav>

      {member ? <MemberSheet uid={member} onClose={() => setMember(null)} /> : null}
      {inviting ? <InviteSheet onClose={() => setInviting(false)} /> : null}
    </div>
  );
}

/** O poll aberto mais urgente, expandido (opções como botões grandes). O voto em si acontece em /turma/votos. */
function TopPoll({ poll }: { poll: Poll }) {
  const { bundle: b, base, me, profileOf } = useBundle();
  const options = optionsOf(b, poll.id);
  const tally = new Map(tallyPoll(b, poll.id).map((r) => [r.optionId, r]));
  const { voted, total } = votersCount(b, poll.id);
  const winners = pollWinners(b, poll.id);
  const max = Math.max(1, ...options.map((o) => tally.get(o.id)?.votes ?? 0));
  const mine = myVotes(b, poll.id, me);
  const tie = winners.length > 1 && pollState(b, poll.id) === 'open';
  return (
    <article className={t.top} aria-labelledby={`top-${poll.id}`}>
      <span className={t.eyebrow}>{voted} de {total} votaram</span>
      <h3 id={`top-${poll.id}`} className="disp">{poll.question}</h3>
      <ul className={t.topOpts}>
        {options.map((o) => {
          const r = tally.get(o.id);
          const votes = r?.votes ?? 0;
          return (
            <li key={o.id}>
              <Link href={`${base}/turma/votos`} className={t.topOpt} data-mine={mine.includes(o.id)}>
                <span className={t.optHead}><b>{o.label}</b>{o.price != null && o.currency ? <span className="mono">{o.price} {o.currency}</span> : null}</span>
                <span className={t.optBar}><i style={{ width: `${(votes / max) * 100}%` }} /></span>
                <span className={t.optMeta}>
                  {plural(votes, 'voto', 'votos')}
                  {r?.voters.length ? ` · ${r.voters.map((u) => profileOf(u)?.display_name ?? 'Pessoa').join(', ')}` : ''}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {tie ? <p className={t.tie}>Empate. Seu voto decide, e a escolha já vai para Dinheiro › Hospedagem.</p> : null}
    </article>
  );
}

/** "Quem leva o quê": itens com responsável (chip na cor da pessoa) e "todos" para os individuais. */
function WhoBrings() {
  const { bundle: b, profileOf, base } = useBundle();
  const items = b.packingItems.filter((i) => !i.done).slice(0, 6);
  if (!items.length) return null;
  return (
    <ul className={t.who} aria-label="Quem leva o quê">
      {items.map((i) => {
        const p = i.assignee_id ? profileOf(i.assignee_id) : null;
        return (
          <li key={i.id}>
            <Link href={`${base}/turma/mala`} className={t.whoRow}>
              <span>{i.label}</span>
              <span className={t.chipWho} style={p?.color ? { background: p.color } : undefined} data-all={!p}>{p ? p.display_name.split(' ')[0] : 'todos'}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function MemberSheet({ uid, onClose }: { uid: string; onClose: () => void }) {
  const { bundle: b, isOrganizer, me, profileOf, source, reload } = useBundle();
  const { refreshTrips } = useAuth();
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const m = b.members.find((x) => x.user_id === uid);
  if (!m) return null;
  const p = profileOf(uid);
  const name = p?.display_name ?? 'Pessoa';
  const self = uid === me;
  const pend = memberPending(b, uid);
  const changeRole = (r: Role) => run(() => source.updateWhere('trip_members', { trip_id: b.trip.id, user_id: uid }, { role: r }).then(reload), { success: 'Papel atualizado.' });
  const remove = async () => {
    const ok = await confirm({
      title: self ? 'Sair da trilha?' : `Remover ${name}?`,
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
    onClose();
  };
  return (
    <Sheet open onClose={onClose} title={name} description={`${ROLE_LABEL[m.role]}${self ? ' · você' : ''}`}>
      <div className={t.sheetBody}>
        <p style={{ margin: 0 }}><b>Pendências:</b> {pend ?? 'em dia'}</p>
        {isOrganizer && !self ? (
          <label className="field">Papel
            <select aria-label={`Papel de ${name}`} value={m.role} disabled={busy} onChange={(e) => void changeRole(e.target.value as Role)}>
              <option value="organizer">Organiza</option>
              <option value="editor">Pode editar</option>
              <option value="viewer">Só consulta</option>
            </select>
          </label>
        ) : null}
        <button type="button" className="btn btn-danger tap" onClick={() => void remove()} disabled={busy}>{self ? 'Sair da trilha' : `Remover ${name}`}</button>
      </div>
    </Sheet>
  );
}

export function InviteSheet({ onClose }: { onClose: () => void }) {
  const { bundle: b, isOrganizer, source } = useBundle();
  const { run, busy } = useAction();
  const toast = useToast();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [link, setLink] = useState<string | null>(null);
  const [role, setRole] = useState<Exclude<Role, 'organizer'>>('editor');
  const [hours, setHours] = useState(168);
  const [uses, setUses] = useState(5);

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
      setLink(`${SITE_URL || window.location.origin}/convite/aceitar#${token}`);
      await loadInvites();
    }, { success: 'Convite criado. Copie o link agora: ele não é mostrado de novo.' });

  const revoke = (i: Invite) =>
    run(async () => {
      const r = await getSupabase()!.from('trip_invites').update({ revoked_at: new Date().toISOString() }).eq('id', i.id);
      if (r.error) throw r.error;
      await loadInvites();
    }, { success: 'Convite revogado.' });

  const copy = async () => {
    try { await navigator.clipboard.writeText(link!); toast('Link copiado.'); } catch { toast('Copie manualmente.'); }
  };
  const share = async () => {
    try { await navigator.share({ title: `Trilha: ${b.trip.title}`, url: link! }); } catch { /* cancelado */ }
  };
  const now = Date.now();

  return (
    <Sheet open onClose={onClose} title="Convidar">
      <div className={t.sheetBody}>
        {source.kind === 'demo' ? (
          <p className="muted" style={{ margin: 0 }}>Na demonstração não dá pra convidar. Crie uma trilha para chamar a turma.</p>
        ) : !isOrganizer ? (
          <p className="muted" style={{ margin: 0 }}>Só quem organiza a trilha cria e revoga convites.</p>
        ) : (
          <>
            <FieldGrid>
              <Field label="Papel"><select value={role} onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}><option value="editor">Pode editar</option><option value="viewer">Só consulta</option></select></Field>
              <Field label="Validade"><select value={hours} onChange={(e) => setHours(Number(e.target.value))}><option value={24}>1 dia</option><option value={72}>3 dias</option><option value={168}>7 dias</option><option value={720}>30 dias</option></select></Field>
              <Field label="Usos"><input type="number" min={1} max={100} value={uses} onChange={(e) => setUses(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} /></Field>
            </FieldGrid>
            <Button onClick={create} disabled={busy}><Icon name="plus" size={18} />Gerar link de convite</Button>
            {link ? (
              <div className="field">
                <label htmlFor="convite-link">Link (aparece só agora)</label>
                <input id="convite-link" readOnly value={link} onFocus={(e) => e.target.select()} />
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <Button variant="secondary" size="sm" onClick={() => void copy()}><Icon name="link" size={16} />Copiar</Button>
                  {typeof navigator !== 'undefined' && 'share' in navigator ? <Button variant="secondary" size="sm" onClick={() => void share()}>Compartilhar</Button> : null}
                </div>
                <span className="hint">Quem abrir precisa entrar na conta. Saber o endereço da trilha não dá acesso: só o convite válido.</span>
              </div>
            ) : null}
            {invites.length ? (
              <div>
                <h3 className="h3">Convites</h3>
                <ul className={t.invites}>
                  {invites.map((i) => {
                    const expired = Date.parse(i.expires_at) <= now;
                    const status = i.revoked_at ? 'REVOGADO' : expired ? 'EXPIRADO' : i.uses >= i.max_uses ? 'ESGOTADO' : 'ATIVO';
                    return (
                      <li key={i.id}>
                        <Badge tone={status === 'ATIVO' ? 'ok' : 'neutral'}>{status}</Badge>
                        <span style={{ flex: 1, fontSize: 14 }}>{ROLE_LABEL[i.role]} · {i.uses}/{i.max_uses} usos · até {new Date(i.expires_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                        {status === 'ATIVO' ? <Button variant="secondary" size="sm" onClick={() => void revoke(i)}>Revogar</Button> : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </div>
    </Sheet>
  );
}
