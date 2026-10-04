'use client';
import { useCallback, useEffect, useState } from 'react';
import { useAction, useConfirm, useToast } from '../components/ui/feedback';
import { Floaters, Icon, PageTitle, useReveal } from '../components/ui/primitives';
import { useAuth } from '../data/AuthContext';
import { useBundle } from '../data/TripContext';
import type { Invite, Role } from '../data/types';
import { SITE_URL } from '../lib/env';
import { initials, ROLE_LABEL } from '../lib/format';
import { fgOn } from '../lib/identity/contrast';
import { colorCycle } from '../lib/identity/theme';
import { getSupabase } from '../lib/supabase/client';

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
      <PageTitle eyebrow={b.trip.title} title="Turma" sub="Quem viaja junto. Organizador administra; editores mexem no conteúdo; leitores só consultam." />
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
