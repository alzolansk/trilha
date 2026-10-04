'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAction, useConfirm, useToast } from '../../components/ui/feedback';
import { PageTitle } from '../../components/ui/primitives';
import { useAuth } from '../../data/AuthContext';
import { storageEstimate, wipeAllLocalData } from '../../data/offline';
import { resetLocalState } from '../../data/offlineSync';
import { formatBytes } from '../../lib/format';
import { VAPID_PUBLIC_KEY } from '../../lib/env';
import { getSupabase } from '../../lib/supabase/client';

interface Prefs {
  push_enabled: boolean;
  task_reminders: boolean;
  departure_reminders: boolean;
  weather: boolean;
}

function b64ToBytes(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export default function Conta() {
  const { ready, user, profile, refreshProfile, signOut } = useAuth();
  const router = useRouter();
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const toast = useToast();
  const [name, setName] = useState('');
  const [pass, setPass] = useState('');
  const [prefs, setPrefs] = useState<Prefs>({ push_enabled: false, task_reminders: true, departure_reminders: true, weather: true });
  const [est, setEst] = useState<{ usage: number; quota: number; persisted: boolean } | null>(null);
  const pushSupported = typeof window !== 'undefined' && 'PushManager' in window && 'serviceWorker' in navigator && !!VAPID_PUBLIC_KEY;

  useEffect(() => {
    if (ready && !user) router.replace('/entrar?next=/conta');
  }, [ready, user, router]);
  useEffect(() => {
    setName(profile?.display_name ?? '');
  }, [profile]);
  useEffect(() => {
    void storageEstimate().then(setEst);
    const sb = getSupabase();
    if (!sb || !user) return;
    sb.from('notification_prefs').select('*').eq('user_id', user.id).maybeSingle().then(({ data }) => data && setPrefs(data as Prefs));
  }, [user]);

  if (!user) return null;
  const sb = getSupabase()!;

  const saveProfile = () => run(async () => {
    const r = await sb.from('profiles').update({ display_name: name.trim().slice(0, 60) }).eq('id', user.id);
    if (r.error) throw r.error;
    await refreshProfile();
  }, { success: 'Nome atualizado.' });

  const savePass = () => run(async () => {
    if (pass.length < 8) throw new Error('Use pelo menos 8 caracteres.');
    const { error } = await sb.auth.updateUser({ password: pass });
    if (error) throw error;
    setPass('');
  }, { success: 'Senha alterada.' });

  const savePrefs = (p: Prefs) => run(async () => {
    const r = await sb.from('notification_prefs').upsert({ user_id: user.id, ...p, updated_at: new Date().toISOString() });
    if (r.error) throw r.error;
    setPrefs(p);
  });

  const togglePush = async (on: boolean) => {
    if (!on) {
      await run(async () => {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
          await sub.unsubscribe();
        }
        await savePrefs({ ...prefs, push_enabled: false });
      });
      return;
    }
    await run(async () => {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error('Permissão de notificação negada no navegador.');
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC_KEY) });
      const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      const r = await sb.from('push_subscriptions').upsert({ user_id: user.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_agent: navigator.userAgent.slice(0, 300) }, { onConflict: 'endpoint' });
      if (r.error) throw r.error;
      await savePrefs({ ...prefs, push_enabled: true });
    }, { success: 'Notificações ativadas neste aparelho.' });
  };

  const setAnalytics = (on: boolean) => run(async () => {
    const r = await sb.from('profiles').update({ analytics_opt_in: on }).eq('id', user.id);
    if (r.error) throw r.error;
    await refreshProfile();
  }, { success: on ? 'Obrigado! Só eventos de uso, sem conteúdo das viagens.' : 'Coleta de uso desligada.' });

  const wipe = async () => {
    if (!(await confirm({ title: 'Apagar dados deste aparelho?', message: 'Remove as cópias offline de viagens e documentos deste navegador. Nada é apagado da sua conta.', confirmLabel: 'Apagar' }))) return;
    await wipeAllLocalData();
    resetLocalState();
    setEst(await storageEstimate());
    toast('Dados locais apagados.');
  };

  const box = { padding: 26, display: 'flex', flexDirection: 'column' as const, gap: 14 };
  return (
    <main id="main" className="wrap">
      <header style={{ paddingTop: 20 }}><Link href="/">← Minhas trilhas</Link></header>
      <PageTitle title="Conta" sub={user.email ?? ''} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(360px,100%),1fr))', gap: 22, marginTop: 36 }}>
        <section className="card" style={box}>
          <h2 className="disp" style={{ margin: 0, fontSize: 24 }}>Perfil</h2>
          <label className="field">Nome que a turma vê<input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></label>
          <button className="btn tap" style={{ alignSelf: 'flex-start' }} disabled={busy || !name.trim()} onClick={saveProfile}>Salvar nome</button>
          <label className="field">Nova senha<input type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} minLength={8} /></label>
          <button className="btn tap" style={{ alignSelf: 'flex-start' }} disabled={busy || pass.length < 8} onClick={savePass}>Trocar senha</button>
        </section>
        <section className="card" style={box}>
          <h2 className="disp" style={{ margin: 0, fontSize: 24 }}>Notificações</h2>
          {pushSupported ? (
            <label className="check"><input type="checkbox" checked={prefs.push_enabled} disabled={busy} onChange={(e) => void togglePush(e.target.checked)} /><span className="box" aria-hidden="true" /><span>Receber notificações neste aparelho</span></label>
          ) : (
            <p className="muted" style={{ margin: 0 }}>{VAPID_PUBLIC_KEY ? 'Este navegador não suporta notificações push (no iPhone, instale o app na tela inicial primeiro).' : 'Notificações ainda não configuradas no servidor (chaves VAPID, veja o README).'}</p>
          )}
          {(['task_reminders', 'departure_reminders', 'weather'] as const).map((k) => (
            <label key={k} className="check"><input type="checkbox" checked={prefs[k]} disabled={busy} onChange={(e) => void savePrefs({ ...prefs, [k]: e.target.checked })} /><span className="box" aria-hidden="true" />
              <span>{k === 'task_reminders' ? 'Pendências com prazo chegando' : k === 'departure_reminders' ? 'Contagem para o embarque (30, 7 e 1 dia)' : 'Previsão do tempo das paradas (3 dias antes)'}</span></label>
          ))}
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>Enviadas uma vez por dia (limite do plano gratuito de hospedagem).</p>
        </section>
        <section className="card" style={box}>
          <h2 className="disp" style={{ margin: 0, fontSize: 24 }}>Este aparelho</h2>
          <p style={{ margin: 0 }}>{est ? `${formatBytes(est.usage)} usados de ${formatBytes(est.quota)}.` : 'Uso de espaço indisponível neste navegador.'} {est ? (est.persisted ? 'Armazenamento protegido pelo navegador.' : 'O navegador pode apagar as cópias se faltar espaço.') : ''}</p>
          <button className="btn tap" style={{ alignSelf: 'flex-start' }} onClick={wipe}>Apagar dados deste aparelho</button>
          <label className="check"><input type="checkbox" checked={!!profile?.analytics_opt_in} onChange={(e) => void setAnalytics(e.target.checked)} /><span className="box" aria-hidden="true" /><span>Compartilhar estatísticas de uso (anônimas, sem conteúdo)</span></label>
          <button className="btn btn-ink tap" style={{ alignSelf: 'flex-start' }} onClick={() => void signOut()}>Sair da conta</button>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>Ao sair, todas as cópias offline deste navegador são apagadas.</p>
        </section>
      </div>
    </main>
  );
}
