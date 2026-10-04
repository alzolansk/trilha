'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Icon } from '../../components/ui/primitives';
import { useAuth } from '../../data/AuthContext';
import { humanError } from '../../data/source';
import { AUTH_APPLE, AUTH_GOOGLE, AUTH_MAGIC_LINK, SITE_URL } from '../../lib/env';
import { getSupabase } from '../../lib/supabase/client';
import s from './auth.module.css';

function safeNext(n: string | null) {
  return n && n.startsWith('/') && !n.startsWith('//') ? n : '/';
}

function Entrar() {
  const { ready, user, configured } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const [mode, setMode] = useState<'login' | 'signup' | 'magic' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<{ kind: 'err' | 'ok'; text: string } | null>(params.get('erro') ? { kind: 'err', text: 'Não deu pra concluir o login. Tente de novo.' } : null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ready && user) router.replace(next);
  }, [ready, user, router, next]);

  const origin = () => SITE_URL || window.location.origin;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const sb = getSupabase();
    if (!sb) return;
    setBusy(true);
    setMsg(null);
    try {
      if (mode === 'login') {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace(next);
      } else if (mode === 'signup') {
        if (password.length < 8) throw new Error('Use uma senha com pelo menos 8 caracteres.');
        const { data, error } = await sb.auth.signUp({ email, password, options: { data: { display_name: name.trim() || email.split('@')[0] }, emailRedirectTo: `${origin()}/auth/callback?next=${encodeURIComponent(next)}` } });
        if (error) throw error;
        if (data.session) router.replace(next);
        else setMsg({ kind: 'ok', text: 'Conta criada. Confirme pelo link enviado ao seu e-mail para entrar.' });
      } else if (mode === 'magic') {
        const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: `${origin()}/auth/callback?next=${encodeURIComponent(next)}` } });
        if (error) throw error;
        setMsg({ kind: 'ok', text: 'Se o e-mail estiver liberado, um link de acesso foi enviado. Confira a caixa de entrada.' });
      } else {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${origin()}/auth/callback?next=/conta` });
        if (error) throw error;
        setMsg({ kind: 'ok', text: 'Se houver conta com esse e-mail, enviamos um link para criar nova senha.' });
      }
    } catch (err) {
      const m = humanError(err);
      setMsg({ kind: 'err', text: /Invalid login credentials/i.test(m) ? 'E-mail ou senha incorretos.' : /already registered/i.test(m) ? 'Esse e-mail já tem conta. Entre com a senha.' : /rate limit/i.test(m) ? 'Muitas tentativas de e-mail agora. Espere um pouco ou use e-mail e senha.' : m });
    } finally {
      setBusy(false);
    }
  };

  const oauth = async (provider: 'google' | 'apple') => {
    const sb = getSupabase();
    if (!sb) return;
    const { error } = await sb.auth.signInWithOAuth({ provider, options: { redirectTo: `${origin()}/auth/callback?next=${encodeURIComponent(next)}` } });
    if (error) setMsg({ kind: 'err', text: humanError(error) });
  };

  return (
    <main id="main" className={s.page}>
      <div className={s.card}>
        <Link href="/identidades" className={s.logo}><span className="motif" />trilha</Link>
        <h1 className="disp" style={{ margin: 0, fontSize: 'clamp(40px,6vw,64px)', lineHeight: 0.95 }}>
          {mode === 'signup' ? 'Criar conta' : mode === 'reset' ? 'Nova senha' : 'Entrar'}
        </h1>
        <p style={{ margin: 0, color: 'var(--mute)' }}>Countdown, roteiro, documentos offline e gastos com a turma.</p>
        {!configured ? (
          <div className="errbox">O Supabase ainda não está configurado neste ambiente (veja o README). Enquanto isso, explore a <Link href="/identidades">demonstração</Link>.</div>
        ) : (
          <>
            {AUTH_GOOGLE || AUTH_APPLE ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {AUTH_GOOGLE ? <button className="btn tap" style={{ justifyContent: 'center' }} onClick={() => void oauth('google')}>Continuar com Google</button> : null}
                {AUTH_APPLE ? <button className="btn tap" style={{ justifyContent: 'center' }} onClick={() => void oauth('apple')}>Continuar com Apple</button> : null}
                <span className="mono" style={{ textAlign: 'center', fontSize: 11, color: 'var(--mute)' }}>OU COM E-MAIL</span>
              </div>
            ) : null}
            <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {mode === 'signup' ? <label className="field">Seu nome<input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label> : null}
              <label className="field">E-mail<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
              {mode === 'login' || mode === 'signup' ? (
                <label className="field">Senha<input type="password" required minLength={mode === 'signup' ? 8 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} /></label>
              ) : null}
              {msg ? <div role={msg.kind === 'err' ? 'alert' : 'status'} className={msg.kind === 'err' ? 'errbox' : 'ai'}>{msg.text}</div> : null}
              <button className="btn btn-ink tap" style={{ justifyContent: 'center' }} disabled={busy}>
                {busy ? 'Aguarde…' : mode === 'login' ? 'Entrar' : mode === 'signup' ? 'Criar conta' : mode === 'magic' ? 'Enviar link de acesso' : 'Enviar link'}
                <Icon name="arrow" size={18} />
              </button>
            </form>
            <div className={s.links}>
              {mode !== 'login' ? <button onClick={() => setMode('login')}>Já tenho conta</button> : <button onClick={() => setMode('signup')}>Criar conta</button>}
              {AUTH_MAGIC_LINK && mode !== 'magic' ? <button onClick={() => setMode('magic')}>Entrar com link por e-mail</button> : null}
              {mode === 'login' ? <button onClick={() => setMode('reset')}>Esqueci a senha</button> : null}
            </div>
            {mode === 'reset' || mode === 'magic' ? <p className="mono" style={{ margin: 0, fontSize: 11, color: 'var(--mute)' }}>E-MAILS DEPENDEM DO SMTP CONFIGURADO NO SUPABASE (VEJA O README).</p> : null}
          </>
        )}
        <Link href="/identidades" className="mono" style={{ fontSize: 12 }}>VER DEMONSTRAÇÃO SEM CONTA →</Link>
      </div>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Entrar />
    </Suspense>
  );
}
