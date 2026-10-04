'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '../../../data/AuthContext';
import { humanError } from '../../../data/source';
import { ROLE_LABEL } from '../../../lib/format';
import { getSupabase } from '../../../lib/supabase/client';
import s from '../../entrar/auth.module.css';

/**
 * Aceitar convite. O link gerado pelo app é /convite/aceitar#<token> (token no fragmento,
 * fora de logs). Também aceita /convite/<token>. A validação acontece no banco (RPC).
 */
export default function Convite() {
  const { token: pathToken } = useParams<{ token: string }>();
  const { ready, user, refreshTrips } = useAuth();
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [info, setInfo] = useState<{ trip_title: string; role: string; expires_at: string; valid: boolean } | null | 'none'>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const h = window.location.hash.replace(/^#/, '');
    const t = /^[0-9a-f]{64}$/i.test(h) ? h : /^[0-9a-f]{64}$/i.test(pathToken) ? pathToken : null;
    if (t) {
      try {
        sessionStorage.setItem('trilha.invite', t);
      } catch {
        /* ignora */
      }
      setToken(t);
    } else {
      try {
        setToken(sessionStorage.getItem('trilha.invite'));
      } catch {
        setToken(null);
      }
    }
  }, [pathToken]);

  useEffect(() => {
    if (!ready || !user || !token) return;
    const sb = getSupabase();
    if (!sb) return;
    sb.rpc('preview_invite', { p_token: token }).then(({ data, error }) => {
      if (error) setErr(humanError(error));
      else setInfo(data?.[0] ?? 'none');
    });
  }, [ready, user, token]);

  const accept = async () => {
    const sb = getSupabase();
    if (!sb || !token) return;
    setBusy(true);
    const { data, error } = await sb.rpc('accept_invite', { p_token: token });
    setBusy(false);
    if (error) return setErr(humanError(error));
    try {
      sessionStorage.removeItem('trilha.invite');
    } catch {
      /* ignora */
    }
    await refreshTrips();
    router.replace(`/t/${data}`);
  };

  return (
    <main id="main" className={s.page}>
      <div className={s.card}>
        <Link href="/" className={s.logo}><span className="motif" />trilha</Link>
        <h1 className="disp" style={{ margin: 0, fontSize: 48, lineHeight: 0.95 }}>Convite</h1>
        {!token ? (
          <div className="errbox">Link de convite incompleto. Peça um novo para quem organiza a trilha.</div>
        ) : !ready ? (
          <div className="skel" style={{ height: 80 }} />
        ) : !user ? (
          <>
            <p style={{ margin: 0 }}>Entre ou crie sua conta para ver e aceitar o convite.</p>
            <Link className="btn btn-ink tap" style={{ justifyContent: 'center' }} href={`/entrar?next=${encodeURIComponent('/convite/aceitar')}`}>Entrar para aceitar</Link>
          </>
        ) : err ? (
          <div className="errbox" role="alert">{err}</div>
        ) : info === null ? (
          <div className="skel" style={{ height: 80 }} />
        ) : info === 'none' ? (
          <div className="errbox">Convite inválido.</div>
        ) : !info.valid ? (
          <div className="errbox">Esse convite para “{info.trip_title}” expirou, foi revogado ou já atingiu o limite de usos.</div>
        ) : (
          <>
            <p style={{ margin: 0, fontSize: 18 }}>Você foi convidado para <b>{info.trip_title}</b> como <b>{ROLE_LABEL[info.role]?.toLowerCase()}</b>.</p>
            <p className="mono" style={{ margin: 0, fontSize: 12, color: 'var(--mute)' }}>VÁLIDO ATÉ {new Date(info.expires_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</p>
            <button className="btn btn-primary tap" style={{ justifyContent: 'center' }} onClick={accept} disabled={busy}>{busy ? 'Entrando…' : 'Aceitar e abrir a trilha'}</button>
          </>
        )}
      </div>
    </main>
  );
}
