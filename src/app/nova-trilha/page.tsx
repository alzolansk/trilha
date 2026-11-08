'use client';
import { Busy, PageLoader } from '../../components/ui/Loader';
// Nova trilha, passo 1 do onboarding roteirizado (planning §10.3): pra onde, quando e quantos.
// Cria a trilha e segue para /t/[id]/montar (passos 2 a 6). Sem destino: nome e datas, e segue para o Descobrir.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useAction } from '../../components/ui/feedback';
import { Button } from '../../components/ui/Button';
import { Chip } from '../../components/ui/Chip';
import { Field, FieldGrid } from '../../components/ui/Field';
import { Logo } from '../../components/ui/Logo';
import { ChatOptions, ReplyBubble, StepChat, TrilhaBubble } from '../../components/ui/StepChat';
import { useAuth } from '../../data/AuthContext';
import type { OnboardingState } from '../../data/types';
import { getSupabase } from '../../lib/supabase/client';
import { addDays, daysBetween, localTimeZone } from '../../lib/time';

const MAX_DAYS = 60;

function NovaTrilha() {
  const { ready, user, refreshTrips } = useAuth();
  const router = useRouter();
  const { run, busy } = useAction();
  const [mode, setMode] = useState<'dest' | 'plan'>('dest');
  const [dest, setDest] = useState('');
  const [name, setName] = useState('');
  const [flex, setFlex] = useState(false);
  const [v, setV] = useState({ start: '', end: '', month: '', days: 10, origin: '', people: 2 });

  useEffect(() => {
    if (ready && !user) router.replace('/entrar?next=/nova-trilha');
  }, [ready, user, router]);

  // Datas: exatas ou "sem data certa" (mês + dias → começa no dia 1 do mês).
  const start = flex ? (v.month ? `${v.month}-01` : '') : v.start;
  const end = flex ? (start ? addDays(start, Math.max(1, v.days) - 1) : '') : v.end;
  const datesOk = !!start && !!end && end >= start && daysBetween(start, end) + 1 <= 366;
  const days = datesOk ? daysBetween(start, end) + 1 : 0;
  const planning = mode === 'plan';
  const ok = datesOk && (planning ? name.trim().length > 0 : dest.trim().length >= 2);

  const create = () =>
    run(async () => {
      const sb = getSupabase();
      if (!sb || !user) throw new Error('Entre na sua conta para criar a trilha.');
      const id = crypto.randomUUID();
      const destinations = planning ? [] : dest.split(',').map((d) => d.trim().slice(0, 80)).filter(Boolean).slice(0, 6);
      const onboarding: OnboardingState | null = planning ? null : { status: 'em_andamento', step: 2, flexible_dates: flex || undefined };
      const tz = localTimeZone();
      const ins = await sb.from('trips').insert({
        id, title: (planning ? name : destinations.join(', ') || dest).trim().slice(0, 80), destinations,
        start_date: start, end_date: end, departure_at: null, departure_tz: tz, home_tz: tz,
        origin: v.origin.trim().slice(0, 60) || null, style: 'Cultural', created_by: user.id, identity: null, accent: null,
        party_size: Math.min(50, Math.max(1, v.people)), onboarding,
      });
      if (ins.error) throw ins.error;
      await sb.from('packing_categories').insert(['Documentos', 'Roupas', 'Equipamento', 'Farmácia'].map((n, i) => ({ trip_id: id, name: n, position: i })));
      await sb.from('budget_categories').insert(['Transporte', 'Hospedagem', 'Passeios', 'Comida'].map((n, i) => ({ trip_id: id, name: n, position: i, planned: 0, color: '#000000' })));
      await refreshTrips();
      router.replace(planning ? `/t/${id}/descobrir` : `/t/${id}/montar?passo=2`);
    });

  if (!ready || !user) return <PageLoader messages={['Preparando uma trilha nova', 'Abrindo o mapa']} />;
  return (
    <div className="wrap" style={{ display: 'flex', flexDirection: 'column', gap: 28, paddingTop: 28, maxWidth: 720 }}>
      <header><Link href="/" aria-label="Trilha, início"><Logo /></Link></header>
      <main id="main">
        <StepChat label="Nova trilha">
          <TrilhaBubble step="1 de 6">{planning ? 'Sem destino ainda, tudo bem. Qual o nome da viagem e quando?' : 'Pra onde vai a próxima trilha, quando e com quantas pessoas?'}</TrilhaBubble>
          {planning ? <ReplyBubble onEdit={() => setMode('dest')}>Ainda não sei o destino</ReplyBubble> : null}
          <ChatOptions>
            {planning ? (
              <Field label="Nome da viagem"><input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Viagem com a turma" /></Field>
            ) : (
              <Field label="Destino" hint="País, região ou cidade. Vários? Separe por vírgula.">
                <input value={dest} maxLength={160} onChange={(e) => setDest(e.target.value)} placeholder="Itália" autoFocus />
              </Field>
            )}
            {flex ? (
              <FieldGrid>
                <Field label="Mês"><input type="month" value={v.month} onChange={(e) => setV({ ...v, month: e.target.value })} /></Field>
                <Field label="Dias"><input type="number" inputMode="numeric" min={1} max={MAX_DAYS} value={v.days} onChange={(e) => setV({ ...v, days: Math.min(MAX_DAYS, Math.max(1, Number(e.target.value) || 1)) })} /></Field>
              </FieldGrid>
            ) : (
              <FieldGrid>
                <Field label="Ida"><input type="date" value={v.start} onChange={(e) => setV({ ...v, start: e.target.value })} required /></Field>
                <Field label="Volta" error={v.start && v.end && v.end < v.start ? 'A volta precisa ser depois da ida.' : undefined}><input type="date" value={v.end} min={v.start} onChange={(e) => setV({ ...v, end: e.target.value })} required /></Field>
              </FieldGrid>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <Chip selected={flex} onClick={() => setFlex(!flex)}>Sem data certa</Chip>
              {days ? <span className="muted" style={{ fontSize: 14 }}>{days} dia{days > 1 ? 's' : ''} · {days - 1} noite{days - 1 === 1 ? '' : 's'}</span> : null}
            </div>
            <FieldGrid>
              <Field label="Saindo de" hint={planning ? undefined : 'Sem isso a Trilha não estima o voo.'}><input value={v.origin} maxLength={60} onChange={(e) => setV({ ...v, origin: e.target.value })} placeholder="São Paulo" /></Field>
              <div role="group" aria-labelledby="people-label" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span id="people-label" style={{ font: 'var(--t-small)', fontWeight: 600 }}>Pessoas</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Button variant="secondary" size="sm" aria-label="Uma pessoa a menos" disabled={v.people <= 1} onClick={() => setV({ ...v, people: v.people - 1 })}>−</Button>
                  <output aria-live="polite" data-testid="people" style={{ minWidth: 32, textAlign: 'center', fontWeight: 700 }}>{v.people}</output>
                  <Button variant="secondary" size="sm" aria-label="Uma pessoa a mais" disabled={v.people >= 50} onClick={() => setV({ ...v, people: v.people + 1 })}>+</Button>
                </div>
                <small className="muted">Contando com você. Dá pra convidar depois, mas não precisa.</small>
              </div>
            </FieldGrid>
            <Button disabled={!ok || busy} onClick={create}>{busy ? <Busy>Criando</Busy> : planning ? 'Criar e descobrir destinos' : 'Continuar'}</Button>
            {planning ? null : <Button variant="secondary" onClick={() => setMode('plan')}>Ainda não sei o destino</Button>}
            <Link href="/demo/andes" style={{ fontSize: 14, fontWeight: 600 }}>Ver a demonstração →</Link>
          </ChatOptions>
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
