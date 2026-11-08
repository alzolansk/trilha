'use client';
// Nova trilha (planning §5.4 e §6.7): conversa em passos, sem o passo de identidade.
// Com destino: nome do destino → datas → cria e abre a Início. Sem destino: nome e datas, e segue para o Descobrir.
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { applyAccent } from '../../components/shell/ThemeApplier';
import { useAction } from '../../components/ui/feedback';
import { Button } from '../../components/ui/Button';
import { Chip } from '../../components/ui/Chip';
import { Logo } from '../../components/ui/Logo';
import { ChatOptions, ReplyBubble, StepChat, TrilhaBubble } from '../../components/ui/StepChat';
import { useAuth } from '../../data/AuthContext';
import type { TripStyle } from '../../data/types';
import { DICTIONARY, DICTIONARY_ORDER, matchDictionary } from '../../lib/identity/dictionary';
import { safeAccent } from '../../lib/identity/accent';
import { getSupabase } from '../../lib/supabase/client';
import { localTimeZone, wallToInstant } from '../../lib/time';

const DEST: Record<string, string> = { andes: 'Peru + Bolívia', japao: 'Japão', marrocos: 'Marrocos', islandia: 'Islândia' };
const STYLES: TripStyle[] = ['Mochilão', 'Conforto', 'Aventura', 'Cultural'];

function NovaTrilha() {
  const { ready, user, refreshTrips } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const { run, busy } = useAction();
  const preset = params.get('identidade');
  // 0 = destino · 1 = nome (só sem destino) · 2 = datas
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<'dest' | 'plan'>('dest');
  const [text, setText] = useState(preset && DEST[preset] ? DEST[preset] : '');
  const [name, setName] = useState('');
  const [v, setV] = useState({ start: '', end: '', time: '', tz: 'America/Sao_Paulo', origin: '', style: 'Mochilão' as TripStyle });

  useEffect(() => {
    if (ready && !user) router.replace('/entrar?next=/nova-trilha');
  }, [ready, user, router]);
  useEffect(() => {
    setV((x) => ({ ...x, tz: localTimeZone() }));
    return () => applyAccent(null);
  }, []);

  // Só a cor de destaque acompanha o destino reconhecido.
  const hit = matchDictionary(text);
  useEffect(() => {
    applyAccent(mode === 'dest' && hit ? safeAccent(DICTIONARY[hit].palette.acc) : null);
  }, [hit, mode]);

  const datesOk = !!v.start && !!v.end && v.end >= v.start;
  const create = () =>
    run(async () => {
      const sb = getSupabase();
      if (!sb || !user) throw new Error('Entre na sua conta para criar a trilha.');
      const planning = mode === 'plan';
      const id = crypto.randomUUID();
      const [y, mo, d] = v.start.split('-').map(Number);
      const [h, mi] = (v.time || '00:00').split(':').map(Number);
      const departure = v.time ? new Date(wallToInstant(v.tz, { y, mo, d, h, mi, s: 0 })).toISOString() : null;
      const ins = await sb.from('trips').insert({
        id, title: (planning ? name : text).trim().slice(0, 80), destinations: planning ? [] : [text.trim().slice(0, 80)],
        start_date: v.start, end_date: v.end, departure_at: departure, departure_tz: v.tz, home_tz: localTimeZone(),
        origin: v.origin.trim() || null, style: v.style, created_by: user.id, identity: null,
        accent: !planning && hit ? safeAccent(DICTIONARY[hit].palette.acc) : null,
      });
      if (ins.error) throw ins.error;
      await sb.from('packing_categories').insert(['Documentos', 'Roupas', 'Equipamento', 'Farmácia'].map((n, i) => ({ trip_id: id, name: n, position: i })));
      await sb.from('budget_categories').insert(['Transporte', 'Hospedagem', 'Passeios', 'Comida'].map((n, i) => ({ trip_id: id, name: n, position: i, planned: 0, color: '#000000' })));
      await refreshTrips();
      router.replace(planning ? `/t/${id}/descobrir` : `/t/${id}`);
    });

  if (!ready || !user) return <div className="wrap" style={{ paddingTop: 120 }}><div className="skel" style={{ height: 300 }} /></div>;
  const planning = mode === 'plan';
  return (
    <div className="wrap" style={{ display: 'flex', flexDirection: 'column', gap: 28, paddingTop: 28, maxWidth: 720 }}>
      <header><Link href="/" aria-label="Trilha, início"><Logo /></Link></header>
      <main id="main">
        <StepChat label="Nova trilha">
          <TrilhaBubble step={step === 0 ? '1 de 2' : undefined}>Pra onde vai a próxima trilha?</TrilhaBubble>
          {step === 0 ? (
            <ChatOptions>
              <label className="field">Digite um destino
                <input value={text} maxLength={80} onChange={(e) => setText(e.target.value)} placeholder="Cidade, país ou região" />
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }} role="group" aria-label="Destinos sugeridos">
                {DICTIONARY_ORDER.map((k) => <Chip key={k} selected={hit === k} onClick={() => setText(DEST[k])}>{DEST[k]}</Chip>)}
              </div>
              <Button disabled={text.trim().length < 2} onClick={() => { setMode('dest'); setStep(2); }}>Continuar</Button>
              <Button variant="secondary" onClick={() => { setMode('plan'); setStep(1); }}>Começar sem destino</Button>
              <Link href="/demo/andes" style={{ fontSize: 14, fontWeight: 600 }}>Ver a demonstração →</Link>
            </ChatOptions>
          ) : (
            <ReplyBubble onEdit={() => setStep(0)}>{planning ? 'Ainda não sei' : text.trim()}</ReplyBubble>
          )}

          {planning && step >= 1 ? (
            <>
              <TrilhaBubble>Sem destino ainda, tudo bem. Qual o nome da viagem? O destino a turma escolhe depois, com a ajuda do Descobrir.</TrilhaBubble>
              {step === 1 ? (
                <ChatOptions>
                  <label className="field">Nome da viagem<input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Viagem com a turma" /></label>
                  <Button disabled={!name.trim()} onClick={() => setStep(2)}>Continuar</Button>
                </ChatOptions>
              ) : <ReplyBubble onEdit={() => setStep(1)}>{name.trim()}</ReplyBubble>}
            </>
          ) : null}

          {step === 2 ? (
            <>
              <TrilhaBubble step="2 de 2">Quando e como? Sem data certa, coloque uma aproximada: dá pra mudar depois.</TrilhaBubble>
              <ChatOptions>
                <div className="grid2">
                  <label className="field">Ida<input type="date" value={v.start} onChange={(e) => setV({ ...v, start: e.target.value })} required /></label>
                  <label className="field">Volta<input type="date" value={v.end} min={v.start} onChange={(e) => setV({ ...v, end: e.target.value })} required /></label>
                  {!planning ? <label className="field">Horário do embarque (opcional)<input type="time" value={v.time} onChange={(e) => setV({ ...v, time: e.target.value })} /></label> : null}
                  <label className="field">Saindo de (opcional)<input value={v.origin} maxLength={60} onChange={(e) => setV({ ...v, origin: e.target.value })} placeholder="São Paulo" /></label>
                </div>
                {v.start && v.end && v.end < v.start ? <span className="err">A volta precisa ser depois da ida.</span> : null}
                <div role="group" aria-label="Estilo" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {STYLES.map((x) => <Chip key={x} selected={x === v.style} onClick={() => setV({ ...v, style: x })}>{x}</Chip>)}
                </div>
                <p className="muted" style={{ margin: 0, fontSize: 14 }}>Turma: dá pra convidar depois, em Turma. Fuso do embarque: {v.tz}.</p>
                <Button disabled={!datesOk || busy} onClick={create}>{busy ? 'Criando…' : planning ? 'Criar e descobrir destinos' : 'Criar trilha'}</Button>
              </ChatOptions>
            </>
          ) : null}
        </StepChat>
      </main>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <NovaTrilha />
    </Suspense>
  );
}
