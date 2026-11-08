'use client';
// Descobrir (planning §5.4): questionário em conversa → "Três lugares que cabem na turma".
// Para trilhas sem destino. Respostas de cada pessoa ficam em trip_preferences; "% com a turma" é calculado aqui.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Estimate, EstimateNote, FitBadge } from '../components/plan/PlanBits';
import { useAction, useToast } from '../components/ui/feedback';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Chip } from '../components/ui/Chip';
import { Photo, type PhotoData } from '../components/ui/Photo';
import { Icon } from '../components/ui/primitives';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { ChatOptions, ReplyBubble, StepChat, TrilhaBubble } from '../components/ui/StepChat';
import { useBundle } from '../data/TripContext';
import { useResolvedPhoto } from '../data/usePhoto';
import { callAiOrError } from '../lib/ai/client';
import { VIBES, groupAffinity, parseAnswers, planStops, routeSummary, type DiscoverAnswers } from '../lib/discover';
import { destinationPollId, fitOf, hoursLabel, perPersonCents, rangeLabel } from '../lib/explore';
import { MODE_LABEL, dayMonth } from '../lib/format';
import { toCents } from '../lib/money';
import { hasDestination } from '../lib/plan';
import { parseOnboarding } from '../lib/onboarding';
import { daysBetween } from '../lib/time';
import s from './descobrir.module.css';
import { Field } from '../components/ui';

interface Place {
  name: string; region: string; country: string; lat: number; lng: number; why: string;
  mode: 'bus' | 'car' | 'plane' | 'train' | 'boat'; hours: number; cost_low: number; cost_high: number; km: number | null;
  stops: string[]; photo_query?: string | null; tags: string[];
}
interface Result { items: Place[]; from: string | null; currency: string; model?: string }

const QUESTIONS = ['Quanto cada pessoa pode gastar?', 'Quando e por quantos dias?', 'Quantas pessoas vão?', 'Qual a vibe da viagem?', 'De onde vocês saem?'] as const;
const DAYS = [3, 5, 7, 10, 14];

export default function Descobrir() {
  const { bundle: b, base, canEdit, source, reload, me } = useBundle();
  const router = useRouter();
  const toast = useToast();
  const { run, busy } = useAction();
  const planning = !hasDestination(b);
  const demo = source.kind === 'demo';
  const cur = b.trip.base_currency;
  const cacheKey = `trilha.descobrir.${b.trip.id}`;

  const saved = useMemo(() => parseAnswers(b.tripPreferences?.find((p) => p.user_id === me)?.answers), [b.tripPreferences, me]);
  const tripDays = Math.max(1, daysBetween(b.trip.start_date, b.trip.end_date) + 1);
  const perPerson = perPersonCents(b);
  const [a, setA] = useState<DiscoverAnswers>({
    budget: saved.budget ?? (perPerson ? Math.round(perPerson / 100) : null),
    days: saved.days ?? tripDays,
    start: saved.start ?? b.trip.start_date,
    people: saved.people ?? Math.max(1, b.members.length),
    vibes: saved.vibes ?? [],
    origin: saved.origin ?? b.trip.origin ?? '',
  });
  // Pergunta atual; 5 = resultado. Quem já respondeu antes cai direto nas respostas.
  const [step, setStep] = useState(saved.budget || saved.vibes?.length ? 5 : 0);
  const [budgetText, setBudgetText] = useState(a.budget ? String(a.budget) : '');
  const [res, setRes] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(cacheKey);
      if (raw) setRes(JSON.parse(raw) as Result);
    } catch {
      /* sem armazenamento: só não reaproveita */
    }
  }, [cacheKey]);

  const capCents = a.budget ? toCents(a.budget) : 0;
  const others = (b.tripPreferences ?? []).filter((p) => p.user_id !== me && b.members.some((m) => m.user_id === p.user_id)).map((p) => parseAnswers(p.answers));
  const everyone = [...others, a];

  const finish = async () => {
    setLoading(true);
    setError(null);
    setStep(5);
    try {
      if (!demo) await source.upsert('trip_preferences', { trip_id: b.trip.id, user_id: me, answers: a }, 'trip_id,user_id');
    } catch {
      /* a migration pode não estar aplicada: o resultado sai mesmo assim, só sem lembrar as respostas */
    }
    if (demo) {
      setLoading(false);
      return;
    }
    const r = await callAiOrError<Omit<Result, 'model'>>('explore', {
      kind: 'destinations', tripId: b.trip.id, origin: a.origin?.trim() || null, nearStopId: null,
      budgetPerPerson: a.budget ?? null, maxHours: null, vibes: (a.vibes ?? []).map((v) => VIBES.find((x) => x.id === v)?.label ?? v).slice(0, 6),
    });
    setLoading(false);
    if (!r.ok) return setError(r.error);
    const next = { ...r.res.data, model: r.res.model };
    setRes(next);
    try {
      sessionStorage.setItem(cacheKey, JSON.stringify(next));
    } catch {
      /* ignora */
    }
    void reload();
  };

  // Os três de maior "% com a turma"; sem afinidade, os que cabem primeiro.
  const top = useMemo(() => {
    if (!res) return [];
    const score = (x: Place) => {
      const aff = groupAffinity(x, everyone);
      const fit = fitOf(x.cost_low * 100, x.cost_high * 100, capCents);
      return (aff ?? 0) * 10 + (fit === 'fits' ? 5 : fit === 'free' ? 4 : 0);
    };
    return [...res.items].sort((p, q) => score(q) - score(p)).slice(0, 3);
  }, [res, everyone, capCents]); // eslint-disable-line react-hooks/exhaustive-deps

  const build = (x: Place) =>
    run(async () => {
      const list = x.stops.length >= 1 ? x.stops : [x.name];
      // Conta real: o destino escolhido segue para o onboarding roteirizado (planning §10.3), que monta a rota.
      if (!demo) {
        const prev = parseOnboarding(b.trip.onboarding);
        await source.update('trips', b.trip.id, {
          destinations: [x.name.slice(0, 80)],
          onboarding: { ...(prev ?? {}), status: 'em_andamento', step: 2, places: null, route: null, marks: {}, discover_stops: list.map((n) => n.slice(0, 80)).slice(0, 6) },
        });
        await reload();
        router.push(`${base}/montar?passo=2`);
        return;
      }
      const plan = planStops(list, b.trip.start_date, b.trip.end_date);
      await source.update('trips', b.trip.id, { destinations: [x.name.slice(0, 80)] });
      for (const [i, st] of plan.entries()) {
        await source.insert('stops', { trip_id: b.trip.id, position: i, name: st.name, country: x.country.slice(0, 60) || null, arrival_date: st.arrival_date, departure_date: st.departure_date });
      }
      await reload();
      router.push(base || '/');
    }, { success: `Trilha montada: ${x.name}.` });

  const vote = (x: Place) =>
    run(async () => {
      let pollId = destinationPollId(b);
      if (!pollId) {
        pollId = crypto.randomUUID();
        await source.insert('polls', { id: pollId, trip_id: b.trip.id, question: 'Pra onde a gente vai?', detail: null, target: 'free', stop_id: null, multi: false, closes_at: null, created_by: me }, { returning: false });
      }
      const opts = (b.pollOptions ?? []).filter((o) => o.poll_id === pollId);
      if (opts.some((o) => o.label.toLowerCase() === x.name.toLowerCase())) {
        toast(`${x.name} já está na votação.`);
        return;
      }
      await source.insert('poll_options', {
        id: crypto.randomUUID(), poll_id: pollId, trip_id: b.trip.id, label: x.name.slice(0, 80),
        detail: `${x.why} · ${rangeLabel(x.cost_low * 100, x.cost_high * 100, res?.currency ?? cur)}/pessoa (estimativa da IA)`.slice(0, 300),
        link_url: null, price: null, currency: null, address: null, position: opts.length, created_by: me,
      }, { returning: false });
      await reload();
      router.push(`${base}/turma/votos`);
    }, { success: `${x.name} entrou na votação do destino.` });

  const set = (patch: Partial<DiscoverAnswers>) => setA((p) => ({ ...p, ...patch }));
  const answerText = [
    a.budget ? `Até ${rangeLabel(capCents, capCents, cur).replace('~', '')} por pessoa` : 'Sem teto',
    `${a.days} dias${a.start ? `, a partir de ${dayMonth(a.start)}` : ''}`,
    `${a.people} ${a.people === 1 ? 'pessoa' : 'pessoas'}`,
    a.vibes?.length ? a.vibes.map((v) => VIBES.find((x) => x.id === v)?.label ?? v).join(', ') : 'Qualquer vibe',
    a.origin?.trim() || 'Origem em aberto',
  ];

  return (
    <div className="wrap">
      <ScreenHeader back={base || '/'} title="Descobrir" subtitle="Responda cinco perguntas rápidas e a Trilha sugere lugares que cabem na turma." />
      {!planning ? <p className={s.note}>Esta trilha já tem destino. Você pode explorar alternativas, mas montar a trilha e votar ficam desligados.</p> : null}

      {step < 5 ? (
        <StepChat label="Perguntas do Descobrir">
          {QUESTIONS.slice(0, step).map((q, i) => (
            <div key={q} className={s.pair}>
              <TrilhaBubble>{q}</TrilhaBubble>
              <ReplyBubble onEdit={() => setStep(i)}>{answerText[i]}</ReplyBubble>
            </div>
          ))}
          <TrilhaBubble step={`${step + 1} de 5`}>{QUESTIONS[step]}</TrilhaBubble>
          <ChatOptions>
            {step === 0 ? (
              <>
                <label className="field">Teto por pessoa ({cur})
                  <input inputMode="numeric" value={budgetText} placeholder="1500" onChange={(e) => { const t = e.target.value.replace(/[^\d]/g, ''); setBudgetText(t); set({ budget: t ? Number(t) : null }); }} />
                </label>
                <Button onClick={() => setStep(1)}>Continuar</Button>
              </>
            ) : step === 1 ? (
              <>
                <Field label="Saída"><input type="date" value={a.start ?? ''} onChange={(e) => set({ start: e.target.value || null })} /></Field>
                <div className={s.chips} role="group" aria-label="Quantos dias">
                  {DAYS.map((d) => <Chip key={d} selected={a.days === d} onClick={() => set({ days: d })}>{d} dias</Chip>)}
                </div>
                <Field label="Ou outro número de dias"><input type="number" min={1} max={120} value={a.days ?? ''} onChange={(e) => set({ days: Math.max(1, Math.min(120, Number(e.target.value) || 1)) })} /></Field>
                <Button onClick={() => setStep(2)}>Continuar</Button>
              </>
            ) : step === 2 ? (
              <>
                <Field label="Quantas pessoas"><input type="number" min={1} max={50} value={a.people ?? 1} onChange={(e) => set({ people: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })} /></Field>
                <Button onClick={() => setStep(3)}>Continuar</Button>
              </>
            ) : step === 3 ? (
              <>
                <div className={s.chips} role="group" aria-label="Vibe">
                  {VIBES.map((v) => (
                    <Chip key={v.id} selected={!!a.vibes?.includes(v.id)} onClick={() => set({ vibes: a.vibes?.includes(v.id) ? a.vibes.filter((x) => x !== v.id) : [...(a.vibes ?? []), v.id] })}>{v.label}</Chip>
                  ))}
                </div>
                <Button onClick={() => setStep(4)}>Continuar</Button>
              </>
            ) : (
              <>
                <Field label="Saindo de"><input value={a.origin ?? ''} maxLength={80} placeholder="São Paulo" onChange={(e) => set({ origin: e.target.value })} /></Field>
                <Button onClick={() => void finish()} disabled={!demo && !a.origin?.trim()}><Icon name="sparkle" size={18} fill="currentColor" />Ver os lugares</Button>
              </>
            )}
          </ChatOptions>
        </StepChat>
      ) : (
        <section aria-labelledby="d-res" className={s.result}>
          <div className={s.answers} role="group" aria-label="Suas respostas">
            {answerText.map((t, i) => <button key={QUESTIONS[i]} type="button" className={s.answerChip} onClick={() => setStep(i)} aria-label={`Editar: ${t}`}>{t}</button>)}
          </div>
          <h2 id="d-res" className="disp">Três lugares que cabem na turma</h2>
          {demo ? <p className="muted" style={{ margin: 0 }}>Na demonstração as sugestões ficam desligadas: elas usam a IA da sua conta.</p> : null}
          {loading ? <p className="muted" role="status" style={{ margin: 0 }}>Procurando lugares…</p> : null}
          {error ? (
            <div className="errbox" role="alert">{error}<div style={{ marginTop: 8 }}><Button size="sm" onClick={() => void finish()}>Tentar de novo</Button></div></div>
          ) : null}
          {top.map((x, i) => (
            <PlaceCard key={x.name} x={x} big={i === 0} cap={capCents} currency={res?.currency ?? cur} affinity={groupAffinity(x, everyone)} canAct={canEdit && planning && !demo} busy={busy} onBuild={() => void build(x)} onVote={() => void vote(x)} />
          ))}
          {res ? <EstimateNote model={res.model} /> : null}
          <p className={s.sunNote}>O custo é uma estimativa por pessoa para a viagem toda (transporte, hospedagem dividida e comida), feita pela IA a partir de conhecimento geral. Não é preço ao vivo: confira antes de reservar.</p>
          <Link href={base || '/'} className={s.know}>Já sei para onde vou</Link>
          {planning && destinationPollId(b) ? <Link href={`${base}/turma/votos`} className={s.know}>Ver a votação do destino →</Link> : null}
        </section>
      )}
    </div>
  );
}

function PlaceCard({ x, big, cap, currency, affinity, canAct, busy, onBuild, onVote }: {
  x: Place; big: boolean; cap: number; currency: string; affinity: number | null; canAct: boolean; busy: boolean; onBuild: () => void; onVote: () => void;
}) {
  const { canEdit, source } = useBundle();
  const photo = useResolvedPhoto(null, x.photo_query ?? `${x.name} ${x.country}`, canEdit && source.kind === 'supabase');
  const fit = fitOf(x.cost_low * 100, x.cost_high * 100, cap);
  return (
    <article className={`${s.card} ${big ? s.big : ''}`} aria-label={x.name}>
      {big ? <Photo photo={photo as PhotoData | null} place={x.name} height={160} radius="var(--r-card)" caption={false} /> : null}
      <div className={s.cardHead}>
        <div>
          <h3>{x.name}</h3>
          <span className={s.meta}>{[x.region, x.country].filter(Boolean).join(', ')}</span>
        </div>
        {affinity != null ? <Badge tone="brand">{affinity}% com a turma</Badge> : null}
      </div>
      <div className={s.costRow}>
        <Estimate low={x.cost_low * 100} high={x.cost_high * 100} currency={currency} suffix="por pessoa, viagem toda" />
        <FitBadge fit={fit} high={x.cost_high * 100} cap={cap} currency={currency} />
      </div>
      {x.stops.length ? <p className={s.route}>{routeSummary(x.stops)}</p> : null}
      <p className={s.why}>{x.why}</p>
      <div className={s.facts}>
        {x.stops.length ? <Badge>{x.stops.length} {x.stops.length === 1 ? 'parada' : 'paradas'}</Badge> : null}
        <Badge>{hoursLabel(x.hours)} de {MODE_LABEL[x.mode]?.toLowerCase() ?? x.mode}</Badge>
        {x.tags.slice(0, 3).map((t) => <Badge key={t}>{VIBES.find((v) => v.id === t)?.label ?? t}</Badge>)}
      </div>
      {canAct ? (
        <div className={s.actions}>
          <Button onClick={onBuild} disabled={busy}>Montar esta trilha</Button>
          <Button variant="secondary" onClick={onVote} disabled={busy}>Votar</Button>
        </div>
      ) : null}
    </article>
  );
}
