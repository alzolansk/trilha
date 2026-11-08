'use client';
// Onboarding roteirizado (planning §10): passos 2 a 6 depois de criar a trilha em /nova-trilha.
// A Trilha propõe lugares, rota, passeios e custo; a pessoa ajusta. O rascunho fica em trips.onboarding.
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  BudgetPace, BudgetPlan, BudgetStyle, NearbyIdea, OnboardingPrefs, OnboardingState, OnboardingStep, PlaceIdea, PlaceMark,
  PhotoRef, RouteLeg, RouteProposal, TourIdea, TransportMode,
} from '../data/types';
import { useBundle } from '../data/TripContext';
import { useAuth } from '../data/AuthContext';
import { useResolvedPhoto } from '../data/usePhoto';
import { closeBudget } from '../data/budgetActions';
import { humanError } from '../data/source';
import { callAi, callAiOrError } from '../lib/ai/client';
import { budgetFromPlan, budgetRange, capPerPerson, foodLevels, initialPlan, tourOptions, transportLegs } from '../lib/budgetPlan';
import { VIBES } from '../lib/discover';
import { MODE_LABEL } from '../lib/format';
import { formatMoney } from '../lib/money';
import {
  adjustNights, assignTourDays, cutSuggestions, datesFor, dayTripTours, defaultMarks, foodByCountry, MAX_ROUTE_CALLS, minNightsOfMust,
  moveStop, namesBy, nightsOf, parseOnboarding, placeKey, preselectTours, removeStop, routeToRows, stayEstimatesOf, TRIP_STYLE_OF,
} from '../lib/onboarding';
import { headcount } from '../lib/people';
import { dayMonth } from '../lib/format';
import { daysBetween } from '../lib/time';
import { Button, Checkbox, Chip, EmptyState, EstimateBadge, Field, MoneyInput, Photo, ScreenHeader, Segmented, Skeleton } from '../components/ui';
import { ChatOptions, StepChat, TrilhaBubble } from '../components/ui/StepChat';
import { useAction, useConfirm } from '../components/ui/feedback';
import { InviteSheet } from './Turma';
import s from './montar.module.css';
import m from '../components/money/money.module.css';

const PACES: { value: BudgetPace; label: string }[] = [
  { value: 'leve', label: 'Calmo · poucas cidades' },
  { value: 'moderado', label: 'Equilibrado' },
  { value: 'intenso', label: 'Ver tudo' },
];
const STAYS: { value: BudgetStyle; label: string }[] = [
  { value: 'economico', label: 'Hostel' },
  { value: 'equilibrado', label: 'Pousada / Airbnb' },
  { value: 'conforto', label: 'Hotel' },
];
const MARKS: { value: PlaceMark; label: string }[] = [
  { value: 'must', label: 'Indispensável' },
  { value: 'maybe', label: 'Talvez' },
  { value: 'skip', label: 'Pular' },
];
const DEFAULT_PREFS: OnboardingPrefs = { vibes: ['cidade', 'comida', 'cultura'], pace: 'moderado', stay: 'equilibrado', budget: null };

type AiFail = { unavailable: boolean; error: string } | null;

export default function Montar() {
  const { bundle: b, base, source, reload, canEdit, me } = useBundle();
  const { online } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const { run, busy } = useAction();
  const saved = useMemo(() => parseOnboarding(b.trip.onboarding), [b.trip.onboarding]);
  const [ob, setOb] = useState<OnboardingState>(() => saved ?? { status: 'em_andamento', step: b.stops.length ? 5 : 2 });
  const asked = Number(params.get('passo'));
  const step: OnboardingStep = ([2, 3, 4, 5, 6] as const).includes(asked as OnboardingStep) ? (asked as OnboardingStep) : ob.step;
  const money = (v: number) => formatMoney(v, b.trip.base_currency, { compact: true });

  useEffect(() => {
    if (!canEdit) router.replace(base || '/');
  }, [canEdit, base, router]);

  // Reabrir pelo Orçamento ("Montar o roteiro com a Trilha") numa trilha sem paradas volta o onboarding a andar.
  useEffect(() => {
    if (!canEdit || b.stops.length || ob.status === 'em_andamento') return;
    const next = { ...ob, status: 'em_andamento' as const };
    setOb(next);
    void source.update('trips', b.trip.id, { onboarding: next }).catch(() => undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Grava o rascunho (e o que mais vier junto) e mantém o estado local igual ao banco. */
  const persist = async (next: OnboardingState, extra: Record<string, unknown> = {}) => {
    setOb(next);
    await source.update('trips', b.trip.id, { onboarding: next, ...extra });
    await reload();
  };
  const go = (n: OnboardingStep) => router.replace(`${base}/montar?passo=${n}`);
  const later = () => run(async () => {
    await persist({ ...ob, status: 'pulado' });
    router.push(base || '/');
  });
  const manual = () => run(async () => {
    await persist({ ...ob, status: 'manual' });
    router.push(`${base}/roteiro`);
  });

  if (!canEdit) return null;

  const common = { b, ob, persist, go, busy, run, money, online, manual };
  return (
    <div className="wrap">
      <div className={s.page}>
        <ScreenHeader back={base || '/'} title="Montar a viagem" subtitle={`${b.trip.destinations.join(', ') || b.trip.title} · ${nightsOf(b.trip) + 1} dias`} />
        <div className={s.top}>
          <div className={s.topRow}><span>Passo {step} de 6</span><button type="button" className={s.skip} onClick={later} disabled={busy}>Montar depois</button></div>
          <div className={s.bar} aria-hidden="true"><i style={{ width: `${(step / 6) * 100}%` }} /></div>
        </div>
        {step === 2 ? <StepPrefs {...common} me={me} /> : null}
        {step === 3 ? <StepPlaces {...common} /> : null}
        {step === 4 ? <StepRoute {...common} /> : null}
        {step === 5 ? <StepTours {...common} /> : null}
        {step === 6 ? <StepCost {...common} onDone={() => router.push(base || '/')} /> : null}
      </div>
    </div>
  );
}

interface StepProps {
  b: ReturnType<typeof useBundle>['bundle'];
  ob: OnboardingState;
  persist: (next: OnboardingState, extra?: Record<string, unknown>) => Promise<void>;
  go: (n: OnboardingStep) => void;
  busy: boolean;
  run: ReturnType<typeof useAction>['run'];
  money: (v: number) => string;
  online: boolean;
  manual: () => void;
}

/** Falha da IA (planning §10.15): sem IA vai direto para o manual; erro passageiro pode tentar de novo. */
function AiFailed({ fail, retry, manual }: { fail: NonNullable<AiFail>; retry: () => void; manual: () => void }) {
  return (
    <EmptyState
      icon="info"
      title={fail.unavailable ? 'As sugestões estão indisponíveis agora.' : 'A Trilha não conseguiu sugerir agora.'}
      text={fail.unavailable ? 'Dá pra montar o roteiro do seu jeito: as paradas, trechos e passeios entram pelo Roteiro.' : fail.error}
      action={<div className={s.actions}><Button onClick={manual}>Montar o roteiro eu mesmo</Button>{fail.unavailable ? null : <Button variant="secondary" onClick={retry}>Tentar de novo</Button>}</div>}
    />
  );
}

// ───────────── Passo 2 · Do que vocês gostam ─────────────

function StepPrefs({ b, ob, persist, go, busy, run, me }: StepProps & { me: string }) {
  const { source } = useBundle();
  const people = headcount(b);
  const [p, setP] = useState<OnboardingPrefs>(() => ob.prefs ?? {
    ...DEFAULT_PREFS,
    budget: b.trip.budget_total != null && Number(b.trip.budget_total) > 0 ? Math.round(Number(b.trip.budget_total) / people) : null,
  });
  const toggle = (id: string) => setP({ ...p, vibes: p.vibes.includes(id) ? p.vibes.filter((v) => v !== id) : [...p.vibes, id].slice(0, 6) });
  const next = () => run(async () => {
    const changed = !!ob.prefs && JSON.stringify(ob.prefs) !== JSON.stringify(p);
    const plan: BudgetPlan = { ...(b.trip.budget_plan ?? {}), style: p.stay, pace: p.pace };
    await persist(
      { ...ob, prefs: p, step: Math.max(3, ob.step) as OnboardingStep, stale: changed && ob.route ? [...new Set([...(ob.stale ?? []), 'route' as const])] : ob.stale },
      { style: TRIP_STYLE_OF[p.stay], budget_plan: plan, ...(p.budget ? { budget_total: (p.budget * people).toFixed(2) } : {}) },
    );
    try {
      const prev = b.tripPreferences?.find((x) => x.user_id === me)?.answers ?? {};
      await source.upsert('trip_preferences', { trip_id: b.trip.id, user_id: me, answers: { ...prev, vibes: p.vibes, pace: p.pace, stay: p.stay, budget: p.budget ?? null, people, origin: b.trip.origin ?? null } }, 'trip_id,user_id');
    } catch {
      /* sem a tabela, segue sem lembrar as respostas */
    }
    go(3);
  });

  return (
    <StepChat label="Do que vocês gostam">
      <TrilhaBubble step="2 · Gostos">{nightsOf(b.trip) + 1} dias em {b.trip.destinations.join(', ') || b.trip.title}. <b>Do que vocês gostam</b> numa viagem?</TrilhaBubble>
      <ChatOptions>
        <div className={s.chips} role="group" aria-label="Gostos">
          {VIBES.map((v) => <Chip key={v.id} selected={p.vibes.includes(v.id)} onClick={() => toggle(v.id)}>{v.label}</Chip>)}
        </div>
        <p className={s.label}>Ritmo</p>
        <Segmented label="Ritmo" value={p.pace} onChange={(pace) => setP({ ...p, pace })} options={PACES} block />
        <p className={s.label}>Onde dormir</p>
        <Segmented label="Onde dormir" value={p.stay} onChange={(stay) => setP({ ...p, stay })} options={STAYS} block />
        <MoneyInput label="Teto por pessoa (opcional)" currency={b.trip.base_currency} value={p.budget ? p.budget * 100 : null} onChange={(c) => setP({ ...p, budget: c ? Math.round(c / 100) : null })} hint="Com teto, a Trilha avisa quando a viagem passar dele." />
        <Button disabled={busy || !p.vibes.length} onClick={next}>{busy ? 'Salvando…' : 'Continuar'}</Button>
      </ChatOptions>
    </StepChat>
  );
}

// ───────────── Passo 3 · O que não pode faltar ─────────────

function PlaceCard({ p, mark, onMark, photo }: { p: PlaceIdea; mark: PlaceMark; onMark: (m: PlaceMark) => void; photo: boolean }) {
  const resolved = useResolvedPhoto(null, photo ? p.photo_query || `${p.name}` : null, photo);
  return (
    <article className={s.place} data-place={p.name}>
      {photo ? <Photo photo={resolved as PhotoRef & { url: string } | null} place={p.name} alt="" height={140} /> : null}
      <div className={s.placeHead}><h3>{p.name}</h3><small>{p.nights_min === p.nights_max ? `${p.nights_min} noite${p.nights_min > 1 ? 's' : ''}` : `${p.nights_min} a ${p.nights_max} noites`}</small></div>
      <p className={s.why}>{p.why}</p>
      {p.highlights?.length ? <ul className={s.highlights}>{p.highlights.map((h) => <li key={h}>{h}</li>)}</ul> : null}
      <Segmented label={`${p.name}: quanto quer ir`} value={mark} onChange={onMark} options={MARKS} block />
    </article>
  );
}

function NearbyCard({ n, mark, onMark, money }: { n: NearbyIdea; mark: PlaceMark; onMark: (m: PlaceMark) => void; money: (v: number) => string }) {
  const hours = n.hours < 1 ? `${Math.round(n.hours * 60)} min` : `${String(Math.round(n.hours * 10) / 10).replace('.', ',')}h`;
  return (
    <article className={s.place} data-nearby={n.name}>
      <div className={s.placeHead}><h3>{n.name}{n.country ? <small> · {n.country}</small> : null}</h3><small>{n.kind === 'bate_volta' ? 'bate-volta' : 'pede 1 noite'}</small></div>
      <p className={s.muted}>{hours} de {MODE_LABEL[n.mode as TransportMode]?.toLowerCase() ?? 'viagem'} de {n.from} · ≈ {money(n.cost_low)}–{money(n.cost_high)} por pessoa <EstimateBadge /></p>
      <p className={s.why}>{n.why}</p>
      <Segmented label={`${n.name}: quanto quer ir`} value={mark} onChange={onMark} options={MARKS} block />
    </article>
  );
}

function StepPlaces({ b, ob, persist, go, busy, run, money, online, manual }: StepProps) {
  const [fail, setFail] = useState<AiFail>(null);
  const [loading, setLoading] = useState(false);
  const [marks, setMarks] = useState<Record<string, PlaceMark>>(ob.marks ?? {});
  const [wishes, setWishes] = useState<string[]>(ob.wishes ?? []);
  const [wish, setWish] = useState('');
  const [extra, setExtra] = useState('');
  const asked = useRef(false);
  const places = ob.places;

  const fetchPlaces = async () => {
    setFail(null);
    setLoading(true);
    const r = await callAiOrError<{ items: PlaceIdea[]; nearby: NearbyIdea[] }>('explore', { kind: 'places', tripId: b.trip.id });
    setLoading(false);
    if (!r.ok) { setFail({ unavailable: r.status === 503, error: r.error }); return; }
    const preset = (ob.discover_stops ?? []).filter((n) => !r.res.data.items.some((p) => placeKey(p.name) === placeKey(n)));
    const items: PlaceIdea[] = [...r.res.data.items, ...preset.map((n) => ({ name: n, country: '', why: 'Estava no roteiro sugerido pelo Descobrir.', nights_min: 1, nights_max: 3, from_discover: true }))];
    const nextMarks = defaultMarks(items, r.res.data.nearby, marks);
    setMarks(nextMarks);
    await persist({ ...ob, places: { items, nearby: r.res.data.nearby, fetched_at: new Date().toISOString() }, marks: nextMarks, step: 3 }).catch(() => undefined);
  };
  useEffect(() => {
    if (!places && !asked.current && online) { asked.current = true; void fetchPlaces(); }
  }, [places, online]); // eslint-disable-line react-hooks/exhaustive-deps

  if (fail) return <AiFailed fail={fail} retry={() => void fetchPlaces()} manual={manual} />;
  if (!places || loading) {
    return (
      <StepChat label="O que não pode faltar">
        <TrilhaBubble step="3 · Lugares">Procurando lugares que combinam com vocês…</TrilhaBubble>
        <div className={s.grid} aria-busy="true"><Skeleton h={220} /><Skeleton h={220} /><Skeleton h={220} /></div>
      </StepChat>
    );
  }

  const items = places.items;
  const nearby = places.nearby;
  const nights = nightsOf(b.trip);
  const need = minNightsOfMust(items, nearby, marks);
  const mustCount = namesBy('must', items, nearby, marks).length;
  const mark = (name: string) => (v: PlaceMark) => setMarks({ ...marks, [placeKey(name)]: v });
  const addPlace = () => {
    const name = extra.trim().slice(0, 80);
    if (!name || items.some((p) => placeKey(p.name) === placeKey(name))) { setExtra(''); return; }
    const p: PlaceIdea = { name, country: '', why: 'Você adicionou.', nights_min: 1, nights_max: 3, added: true };
    setMarks({ ...marks, [placeKey(name)]: 'must' });
    void persist({ ...ob, places: { ...places, items: [...items, p] }, marks: { ...marks, [placeKey(name)]: 'must' } }).catch(() => undefined);
    setExtra('');
  };
  const addWish = () => {
    const w = wish.trim().slice(0, 80);
    if (w && !wishes.includes(w) && wishes.length < 5) setWishes([...wishes, w]);
    setWish('');
  };
  const next = () => run(async () => {
    const changed = JSON.stringify(marks) !== JSON.stringify(ob.marks ?? {}) || JSON.stringify(wishes) !== JSON.stringify(ob.wishes ?? []);
    await persist({ ...ob, marks, wishes, step: 4, stale: changed && ob.route ? [...new Set([...(ob.stale ?? []), 'route' as const])] : ob.stale });
    go(4);
  });

  return (
    <StepChat label="O que não pode faltar">
      <TrilhaBubble step="3 · Lugares">Separei lugares que combinam com vocês. <b>O que não pode faltar?</b></TrilhaBubble>
      <ChatOptions>
        <div className={s.grid}>{items.map((p, i) => <PlaceCard key={p.name} p={p} photo={i < 3} mark={marks[placeKey(p.name)] ?? 'maybe'} onMark={mark(p.name)} />)}</div>
        <div className={s.wishRow}>
          <Field label="Adicionar um lugar"><input value={extra} maxLength={80} placeholder="Ex.: Lucca" onChange={(e) => setExtra(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPlace(); } }} /></Field>
          <Button variant="secondary" onClick={addPlace} disabled={!extra.trim()}>Adicionar</Button>
        </div>
        {nearby.length ? (
          <>
            <h2 className={s.label}>Perto daqui</h2>
            <p className={s.muted}>Lugares que ficam perto dos que você viu acima, inclusive em países vizinhos. Muita gente não sabe que dá pra ir.</p>
            <div className={s.grid}>{nearby.map((n) => <NearbyCard key={n.name} n={n} money={money} mark={marks[placeKey(n.name)] ?? 'skip'} onMark={mark(n.name)} />)}</div>
          </>
        ) : null}
        <h2 className={s.label}>Algo que vocês querem fazer?</h2>
        <div className={s.wishRow}>
          <Field label="Desejo"><input value={wish} maxLength={80} placeholder="Ex.: aula de massa, ver a Última Ceia" onChange={(e) => setWish(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addWish(); } }} /></Field>
          <Button variant="secondary" onClick={addWish} disabled={!wish.trim() || wishes.length >= 5}>Incluir</Button>
        </div>
        {wishes.length ? <div className={s.chips}>{wishes.map((w) => <Chip key={w} selected onClick={() => setWishes(wishes.filter((x) => x !== w))} aria-label={`Tirar o desejo ${w}`}>{w} ✕</Chip>)}</div> : null}
        {need > nights ? <p className={s.note}>Esses lugares pedem pelo menos {need} noites e a viagem tem {nights}. A Trilha vai encurtar ou deixar algum de fora.</p> : null}
        <Button disabled={busy} onClick={next}>{mustCount ? 'Montar o roteiro' : 'Deixar a Trilha escolher'}</Button>
      </ChatOptions>
    </StepChat>
  );
}

// ───────────── Passo 4 · Roteiro sugerido ─────────────

function LegLine({ leg, money }: { leg: RouteLeg | null; money: (v: number) => string }) {
  if (!leg) return null;
  const hours = leg.hours ? ` · ${leg.hours < 1 ? `${Math.round(leg.hours * 60)} min` : `${String(Math.round(leg.hours * 10) / 10).replace('.', ',')}h`}` : '';
  return (
    <div className={s.leg}>
      <span>{MODE_LABEL[leg.mode] ?? 'Trecho'} {leg.from} → {leg.to}{hours}</span>
      {leg.cost_low != null && leg.cost_high != null ? <><span>· ≈ {money(Math.round((leg.cost_low + leg.cost_high) / 2))} / pessoa</span><EstimateBadge /></> : <span>· preço a calcular no Orçamento</span>}
    </div>
  );
}

function StepRoute({ b, ob, persist, go, busy, run, money, online, manual }: StepProps) {
  const { source } = useBundle();
  const confirm = useConfirm();
  const [fail, setFail] = useState<AiFail>(null);
  const [loading, setLoading] = useState(false);
  const [route, setRoute] = useState<RouteProposal | null>(ob.route ?? null);
  const [replace, setReplace] = useState(false);
  const [err, setErr] = useState('');
  const asked = useRef(false);
  const nights = nightsOf(b.trip);
  const places = ob.places ?? { items: [], nearby: [] };
  const marks = ob.marks ?? {};
  const stale = ob.stale?.includes('route');
  const calls = ob.route_calls ?? 0;

  const fetchRoute = async (opts: { variant?: 'calmo' | 'mais_lugares'; force?: string[] } = {}) => {
    if (calls >= MAX_ROUTE_CALLS) return;
    setFail(null);
    setLoading(true);
    const body = {
      kind: 'route', tripId: b.trip.id,
      must: namesBy('must', places.items, places.nearby, marks), maybe: namesBy('maybe', places.items, places.nearby, marks),
      skip: namesBy('skip', places.items, places.nearby, marks), wishes: ob.wishes ?? [], variant: opts.variant ?? null, force: opts.force,
    };
    const r = await callAiOrError<{ route: RouteProposal }>('explore', body);
    setLoading(false);
    if (!r.ok) { setFail({ unavailable: r.status === 503, error: r.error }); return; }
    setRoute(r.res.data.route);
    await persist({ ...ob, route: r.res.data.route, route_calls: calls + 1, stale: (ob.stale ?? []).filter((x) => x !== 'route') }).catch(() => undefined);
  };
  useEffect(() => {
    if ((!route || stale) && !asked.current && online) { asked.current = true; void fetchRoute(); }
  }, [route, stale, online]); // eslint-disable-line react-hooks/exhaustive-deps

  if (fail) return <AiFailed fail={fail} retry={() => void fetchRoute()} manual={manual} />;
  if (!route || loading) {
    return (
      <StepChat label="Roteiro sugerido">
        <TrilhaBubble step="4 · Roteiro">Montando a rota com os seus indispensáveis…</TrilhaBubble>
        <div aria-busy="true" className={s.stack}><Skeleton h={60} /><Skeleton h={60} /><Skeleton h={60} /></div>
      </StepChat>
    );
  }

  const dates = datesFor(route, b.trip.start_date);
  const mustNames = new Set(namesBy('must', places.items, places.nearby, marks).map(placeKey));
  const skippedNearby = places.nearby.filter((n) => marks[placeKey(n.name)] === 'skip' && !route.stops.some((x) => placeKey(x.name) === placeKey(n.name))).slice(0, 3);
  const edit = (r: RouteProposal) => setRoute(r);
  const remove = async (i: number) => {
    const st = route.stops[i];
    if (mustNames.has(placeKey(st.name)) && !(await confirm({ title: `Tirar ${st.name}?`, message: `${st.name} estava marcado como indispensável. As noites vão para as outras cidades.`, confirmLabel: 'Tirar do roteiro' }))) return;
    edit(removeStop(route, i, nights));
  };

  const apply = (force = false) => run(async () => {
    setErr('');
    const rows = routeToRows(route, b.trip);
    const range = foodByCountry(route.stops.map((x) => ({ country: x.country, nights: x.nights })), route.food_pp_day);
    const prev = b.trip.budget_plan;
    const plan: BudgetPlan = {
      ...(prev ?? {}),
      style: ob.prefs?.stay ?? prev?.style ?? 'equilibrado',
      pace: ob.prefs?.pace ?? prev?.pace ?? 'moderado',
      stay_estimates: stayEstimatesOf(route, rows.stops.map((x) => x.id)),
      food: 'medio',
      food_range: range,
      daily_food_cents: foodLevels(range).medio,
      transport_cents: {},
      activities: undefined,
    };
    const next: OnboardingState = { ...ob, route, step: 5, tours: {}, tour_pick: [], tours_applied: false, stale: [] };
    try {
      await source.rpc('apply_onboarding_route', {
        p_trip: b.trip.id, p_version: b.trip.version, p_replace: force,
        p_route: { ...rows, budget_plan: plan, onboarding: next },
      });
    } catch (e) {
      const msg = humanError(e);
      if (/Já existe um roteiro/.test(msg)) { setReplace(true); return; }
      setErr(msg);
      return;
    }
    // A RPC já gravou o onboarding; isto só alinha o estado local (e o bundle) com o banco.
    await persist(next);
    go(5);
  });

  return (
    <StepChat label="Roteiro sugerido">
      <TrilhaBubble step="4 · Roteiro">Montei {nights} noites com os seus indispensáveis. <b>Mexa no que quiser.</b></TrilhaBubble>
      <ChatOptions>
        <div className={s.timeline} data-testid="route-timeline">
          <LegLine leg={route.outbound} money={money} />
          {route.stops.map((st, i) => (
            <div key={st.name}>
              {i > 0 ? <LegLine leg={route.legs[i - 1] ?? null} money={money} /> : null}
              <div className={s.stop} data-stop={st.name}>
                <span className={s.dot} aria-hidden="true" />
                <span className={s.stopName}><b>{st.name}</b><small>{st.country ? `${st.country} · ` : ''}{dayMonth(dates[i].arrival)} a {dayMonth(dates[i].departure)}</small></span>
                <span className={s.stopCtl}>
                  <button type="button" className={s.ctl} aria-label={`Uma noite a menos em ${st.name}`} disabled={st.nights <= 1} onClick={() => edit(adjustNights(route, i, -1))}>−</button>
                  <span className={s.nights} aria-label={`${st.nights} noites em ${st.name}`}>{st.nights} n</span>
                  <button type="button" className={s.ctl} aria-label={`Uma noite a mais em ${st.name}`} onClick={() => edit(adjustNights(route, i, 1))}>+</button>
                  <button type="button" className={s.ctl} aria-label={`Subir ${st.name}`} disabled={i === 0} onClick={() => edit(moveStop(route, i, i - 1))}>↑</button>
                  <button type="button" className={s.ctl} aria-label={`Descer ${st.name}`} disabled={i === route.stops.length - 1} onClick={() => edit(moveStop(route, i, i + 1))}>↓</button>
                  <button type="button" className={s.ctl} aria-label={`Tirar ${st.name}`} disabled={route.stops.length <= 1} onClick={() => void remove(i)}>✕</button>
                </span>
                {st.day_trips.length ? <p className={s.dayTrips}>Bate-volta: {st.day_trips.map((d) => `${d.name} (dia ${d.day_offset + 1})`).join(', ')}</p> : null}
              </div>
            </div>
          ))}
          <LegLine leg={route.return} money={money} />
        </div>
        {route.left_out.length ? (
          <>
            <h2 className={s.label}>Ficou de fora</h2>
            {route.left_out.map((l) => (
              <div key={l.name} className={s.cut}><span><b>{l.name}</b><br /><small className={s.muted}>{l.reason}</small></span>{calls < MAX_ROUTE_CALLS ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => void fetchRoute({ force: [l.name] })}>Incluir</Button> : null}</div>
            ))}
          </>
        ) : null}
        {route.wishes.length ? (
          <>
            <h2 className={s.label}>Seus pedidos</h2>
            {route.wishes.map((w) => <p key={w.wish} className={s.muted}>{w.wish} → {w.stop ?? 'não achei onde encaixar'}</p>)}
          </>
        ) : null}
        {calls < MAX_ROUTE_CALLS ? (
          <div className={s.chips} role="group" aria-label="Refazer a rota">
            <Chip onClick={() => void fetchRoute({ variant: 'calmo' })}>Mais calmo</Chip>
            <Chip onClick={() => void fetchRoute({ variant: 'mais_lugares' })}>Mais lugares</Chip>
            {skippedNearby.map((n) => <Chip key={n.name} onClick={() => void fetchRoute({ force: [n.name] })}>Incluir {n.name}</Chip>)}
          </div>
        ) : <p className={s.muted}>Você já pediu {MAX_ROUTE_CALLS} rotas. Os ajustes de noites e ordem continuam valendo.</p>}
        {replace ? (
          <div className={s.note} role="alert">
            Já existe um roteiro nesta trilha. Substituir? Paradas, trechos e passeios atuais serão trocados por este.
            <div className={s.actions} style={{ marginTop: 8 }}><Button size="sm" onClick={() => apply(true)} disabled={busy}>Substituir</Button><Button size="sm" variant="secondary" onClick={() => setReplace(false)}>Cancelar</Button></div>
          </div>
        ) : null}
        {err ? <p className={s.note} role="alert">{err}</p> : null}
        <Button disabled={busy || !online} onClick={() => apply(false)}>{busy ? 'Salvando…' : 'Gostei, ver passeios'}</Button>
      </ChatOptions>
    </StepChat>
  );
}

// ───────────── Passo 5 · Passeios por cidade ─────────────

type AiTour = { title: string; why: string; duration: string; cost_low: number; cost_high: number; tags?: string[]; day_fit?: TourIdea['day_fit']; photo_query?: string | null; wish?: string | null };

function StepTours({ b, ob, persist, go, busy, run, money }: StepProps) {
  const { source, reload } = useBundle();
  const stops = useMemo(() => [...b.stops].sort((x, y) => x.position - y.position), [b.stops]);
  const prefs = ob.prefs ?? DEFAULT_PREFS;
  const [tours, setTours] = useState<Record<string, TourIdea[]>>(ob.tours ?? {});
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [pick, setPick] = useState<Set<string>>(new Set(ob.tour_pick ?? []));
  const started = useRef(false);

  useEffect(() => {
    if (started.current || ob.tours_applied) return;
    started.current = true;
    const missing = stops.filter((st) => !tours[st.id]);
    if (!missing.length) return;
    let alive = true;
    const out: Record<string, TourIdea[]> = { ...tours };
    const chosen = new Set(pick);
    const one = async (st: (typeof stops)[number]) => {
      const r = await callAi<{ items: AiTour[] }>('explore', { kind: 'activities', tripId: b.trip.id, stopId: st.id, capPerPerson: null, vibes: prefs.vibes, wishes: ob.wishes ?? [], pace: prefs.pace });
      const routeStop = ob.route?.stops.find((x) => placeKey(x.name) === placeKey(st.name));
      const extra = routeStop ? dayTripTours(routeStop) : [];
      const ideas: TourIdea[] = [
        ...extra,
        ...(r?.data.items ?? []).map((t, i) => ({
          id: `${st.id}:${i}`, title: t.title, why: t.why, duration: t.duration, cost_low: Math.round(Math.min(t.cost_low, t.cost_high) * 100), cost_high: Math.round(Math.max(t.cost_low, t.cost_high) * 100),
          tags: t.tags ?? [], day_fit: t.day_fit ?? null, photo_query: t.photo_query ?? null, wish: t.wish ?? null,
        })),
      ];
      if (!r) setFailed((f) => new Set([...f, st.id]));
      out[st.id] = ideas;
      const nights = Math.max(0, daysBetween(st.arrival_date, st.departure_date));
      for (const id of extra.map((x) => x.id)) chosen.add(id);
      for (const id of preselectTours(ideas.filter((x) => !x.id.startsWith('bv-')), Math.max(0, nights - extra.length), prefs.pace, prefs.vibes)) chosen.add(id);
      if (alive) { setTours({ ...out }); setPick(new Set(chosen)); }
    };
    void (async () => {
      for (let i = 0; i < missing.length; i += 3) await Promise.all(missing.slice(i, i + 3).map(one));
      if (alive) await persist({ ...ob, tours: out, tour_pick: [...chosen] }).catch(() => undefined);
    })();
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const all = stops.flatMap((st) => tours[st.id] ?? []);
  const picked = all.filter((t) => pick.has(t.id));
  const total = picked.reduce((a, t) => a + Math.round((t.cost_low + t.cost_high) / 2), 0);
  const loadingAny = stops.some((st) => !tours[st.id]);
  const allFailed = !loadingAny && stops.every((st) => failed.has(st.id) && !(tours[st.id] ?? []).length);

  const next = (skip = false) => run(async () => {
    if (ob.tours_applied) { go(6); return; }
    const ids: string[] = [];
    if (!skip) {
      for (const st of stops) {
        const list = tours[st.id] ?? [];
        const chosen = list.filter((t) => pick.has(t.id));
        const days = assignTourDays(st, chosen);
        for (const [i, t] of chosen.entries()) {
          const id = crypto.randomUUID();
          ids.push(id);
          await source.insert('activities', {
            id, trip_id: b.trip.id, stop_id: st.id, day: days.get(t.id) ?? st.arrival_date, title: t.title.slice(0, 160), position: i,
            notes: [t.duration, t.wish ? `seu pedido: ${t.wish}` : null].filter(Boolean).join(' · ').slice(0, 2000) || null,
            suggested_by: 'ai', cost_cents: Math.round((t.cost_low + t.cost_high) / 2), cost_currency: b.trip.base_currency, cost_is_estimate: true,
          });
        }
        for (const t of list.filter((x) => !pick.has(x.id))) {
          await source.insert('suggestions', {
            trip_id: b.trip.id, stop_id: st.id, kind: 'activity', status: 'new', source: 'ai',
            payload: { title: t.title.slice(0, 80), why: t.why ?? null, duration: t.duration ?? null, day_fit: t.day_fit ?? null, cost_low: t.cost_low, cost_high: t.cost_high, currency: b.trip.base_currency, photo_query: t.photo_query ?? null },
          });
        }
      }
    }
    const plan: BudgetPlan = { ...(b.trip.budget_plan ?? { style: prefs.stay, pace: prefs.pace }), activities: skip ? undefined : ids };
    await persist({ ...ob, step: 6, tours, tour_pick: [...pick], tours_applied: true }, { budget_plan: plan });
    await reload();
    go(6);
  });

  if (ob.tours_applied) {
    return (
      <StepChat label="Passeios por cidade">
        <TrilhaBubble step="5 · Passeios">Os passeios escolhidos já estão no roteiro. Dá pra mexer neles pelo Roteiro.</TrilhaBubble>
        <ChatOptions><Button onClick={() => go(6)}>Ver quanto custa</Button></ChatOptions>
      </StepChat>
    );
  }
  if (allFailed) {
    return (
      <StepChat label="Passeios por cidade">
        <TrilhaBubble step="5 · Passeios">Não consegui sugerir passeios agora. O orçamento usa uma reserva de passeios pelo ritmo da viagem.</TrilhaBubble>
        <ChatOptions><Button disabled={busy} onClick={() => next(true)}>Pular passeios</Button></ChatOptions>
      </StepChat>
    );
  }
  return (
    <StepChat label="Passeios por cidade">
      <TrilhaBubble step="5 · Passeios">Separei passeios por cidade. <b>Desmarque o que não for a cara de vocês.</b></TrilhaBubble>
      <ChatOptions>
        {stops.map((st) => {
          const list = tours[st.id];
          const nights = Math.max(0, daysBetween(st.arrival_date, st.departure_date));
          return (
            <section key={st.id} className={s.city} aria-label={`Passeios em ${st.name}`}>
              <h3>{st.name} · {nights} noite{nights === 1 ? '' : 's'}</h3>
              {!list ? <Skeleton h={90} /> : !list.length ? <p className={s.muted}>Sem sugestões agora.</p> : list.map((t) => (
                <div key={t.id} className={s.tour}>
                  <Checkbox label={t.title} hideLabel checked={pick.has(t.id)} onChange={(on) => { const n = new Set(pick); if (on) n.add(t.id); else n.delete(t.id); setPick(n); }}>
                    <span className={s.tourText} aria-hidden="true"><b>{t.title}{t.wish ? <span className={s.wish}>seu pedido</span> : null}</b><small>{[t.duration, t.why].filter(Boolean).join(' · ')}</small></span>
                  </Checkbox>
                  <span className={s.price}>{t.cost_high === 0 ? 'grátis' : `≈ ${money(Math.round((t.cost_low + t.cost_high) / 2))}`}</span>
                </div>
              ))}
            </section>
          );
        })}
        <div className={s.foot}>
          <span><b>{picked.length} passeios</b> · ≈ {money(total)} por pessoa <EstimateBadge /></span>
          <Button disabled={busy || loadingAny} onClick={() => next(false)}>{busy ? 'Salvando…' : 'Ver quanto custa'}</Button>
        </div>
      </ChatOptions>
    </StepChat>
  );
}

// ───────────── Passo 6 · Quanto custa ─────────────

function StepCost({ b, ob, persist, busy, run, money, online, onDone }: StepProps & { onDone: () => void }) {
  const { source } = useBundle();
  const [plan, setPlan] = useState<BudgetPlan>(() => initialPlan(b));
  const [inviting, setInviting] = useState(false);
  const result = budgetFromPlan(b, plan);
  const range = budgetRange(result, plan);
  const cap = capPerPerson(b);
  const legs = transportLegs(b, plan);
  const flights = legs.filter((l) => /^Voo/.test(l.title));
  const ground = legs.filter((l) => !/^Voo/.test(l.title));
  const sum = (xs: typeof legs) => xs.reduce((a, l) => a + (l.perPersonCents ?? 0), 0);
  const tours = tourOptions(b);
  const line = (k: string) => result.lines.find((l) => l.kind === k)!.perPersonCents;
  const cuts = cap != null && range.mid > cap ? cutSuggestions(plan, tours, (p) => budgetFromPlan(b, { ...plan, ...p }).perPersonCents) : [];
  const daily = plan.daily_food_cents ?? 0;
  const styleName = { economico: 'hostel', equilibrado: 'pousada', conforto: 'hotel' }[plan.style];

  const finish = (invite: boolean) => run(async () => {
    await closeBudget(source, b, plan, result, {});
    await persist({ ...ob, status: 'concluido' });
    if (invite) setInviting(true);
    else onDone();
  }, { success: 'Viagem montada. Tudo que é estimativa continua com o selo até alguém confirmar.' });

  return (
    <StepChat label="Quanto custa">
      <TrilhaBubble step="6 · Quanto custa">
        Essa é a viagem de vocês.{' '}
        {cap != null ? (range.mid <= cap ? <>Cabe no teto, com folga de <b>{money(cap - range.mid)}</b>.</> : <>Passa <b>{money(range.mid - cap)}</b> do teto.</>) : null}
      </TrilhaBubble>
      <ChatOptions>
        <section className={m.summary} aria-label="Quanto custa" aria-live="polite">
          <div className={m.row}>
            <div><small>Por pessoa</small><br /><strong data-testid="onboarding-total">≈ {money(range.mid)}</strong></div>
            <div><small>{result.people} pessoa{result.people > 1 ? 's' : ''}</small><br /><b>≈ {money(result.totalCents)}</b></div>
          </div>
          <EstimateBadge />
          {range.high > range.low ? <small>entre {money(range.low)} e {money(range.high)} por pessoa</small> : null}
          <div className={s.lines}>
            {flights.length ? <div className={s.line}><span>Voo{flights.length > 1 ? 's' : ''} ({flights.length})</span><span>{money(sum(flights))}</span></div> : null}
            {ground.length ? <div className={s.line}><span>Trechos entre cidades · {ground.length}</span><span>{money(sum(ground))}</span></div> : null}
            <div className={s.line}><span>Hospedagem · {result.nights} noites ({styleName})</span><span>{money(line('hospedagem'))}</span></div>
            <div className={s.line}><span>Passeios{plan.activities ? ` · ${plan.activities.length}` : ''}</span><span>{money(line('passeios'))}</span></div>
            <div className={s.line}><span>Comida · {result.days} dias × {money(daily)}</span><span>{money(line('comida'))}</span></div>
          </div>
        </section>
        {legs.some((l) => l.perPersonCents == null) ? <p className={s.muted}>Alguns trechos ainda estão sem preço. Dá pra estimar depois em Dinheiro › Orçamento.</p> : null}
        {cuts.length ? (
          <>
            <h2 className={s.label}>Pra caber no teto</h2>
            {cuts.map((c) => (
              <div key={c.label} className={s.cut}>
                <span>{c.label} · economiza {money(c.savesCents)} por pessoa</span>
                <Button size="sm" variant="secondary" onClick={() => {
                  if (c.label.startsWith('Trocar')) setPlan({ ...plan, style: plan.style === 'conforto' ? 'equilibrado' : 'economico' });
                  else {
                    const top = tours.filter((t) => plan.activities?.includes(t.id) && t.perPersonCents != null).sort((x, y) => (y.perPersonCents ?? 0) - (x.perPersonCents ?? 0)).slice(0, 2).map((t) => t.id);
                    setPlan({ ...plan, activities: plan.activities?.filter((id) => !top.includes(id)) });
                  }
                }}>Aplicar</Button>
              </div>
            ))}
          </>
        ) : null}
        <div className={s.actions}>
          <Button disabled={busy || !online} onClick={() => finish(false)}>{busy ? 'Salvando…' : 'Concluir'}</Button>
          <Button variant="secondary" disabled={busy || !online} onClick={() => finish(true)}>Chamar a turma</Button>
        </div>
        {!online ? <p className={s.muted}>Precisa de internet para salvar.</p> : null}
        <p className={s.muted}>Mudou de ideia? Tudo isso fica no <Link href={`../roteiro`}>Roteiro</Link> e em Dinheiro, e dá pra editar quando quiser.</p>
      </ChatOptions>
      {inviting ? <InviteSheet onClose={() => { setInviting(false); onDone(); }} /> : null}
    </StepChat>
  );
}

