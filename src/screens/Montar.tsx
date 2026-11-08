'use client';
// Onboarding roteirizado (planning §10): passos 2 a 6 depois de criar a trilha em /nova-trilha.
// A Trilha propõe lugares, rota, passeios e custo; a pessoa ajusta. O rascunho fica em trips.onboarding.
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  BudgetPace, BudgetPlan, BudgetStyle, NearbyIdea, PlaceAttraction, OnboardingPrefs, OnboardingState, OnboardingStep, PlaceIdea, PlaceInfo, PlaceMark,
  RouteLeg, RouteStop, RouteProposal, TourIdea, TransportMode,
} from '../data/types';
import { useBundle } from '../data/TripContext';
import { useAuth } from '../data/AuthContext';
import { useResolvedPhoto } from '../data/usePhoto';
import { closeBudget } from '../data/budgetActions';
import { humanError } from '../data/source';
import { callAi, callAiOrError } from '../lib/ai/client';
import { budgetFromPlan, budgetRange, capPerPerson, foodLevels, initialPlan, nightFor, tourOptions, transportLegs } from '../lib/budgetPlan';
import { VIBES } from '../lib/discover';
import { MODE_LABEL } from '../lib/format';
import { formatMoney } from '../lib/money';
import {
  adjustNights, applyPlaceInfo, assignTourDays, infoOf, markOf, needsInfo, routeCost, stopCost, type StopCost, cutSuggestions, datesFor, dayTripTours, defaultMarks, foodByCountry,
  MAX_ROUTE_CALLS, minNightsOfMust, moveStop, namesBy, nightsOf, parseOnboarding, placeKey, preselectTours, removeStop, routeToRows, stayEstimatesOf, TRIP_STYLE_OF, wishesAt,
} from '../lib/onboarding';
import { headcount } from '../lib/people';
import { dayMonth } from '../lib/format';
import { daysBetween } from '../lib/time';
import { Badge, Button, Chip, EmptyState, EstimateBadge, Field, Icon, IconButton, MoneyInput, Photo, ScreenHeader, Segmented, Sheet, type PhotoData } from '../components/ui';
import type { IconName } from '../components/ui/icons.data';
import { ChatOptions, StepChat, TrilhaBubble } from '../components/ui/StepChat';
import { AI_STEPS, AiThinking, Busy } from '../components/ui/Loader';
import { useAction, useConfirm } from '../components/ui/feedback';
import { InviteSheet } from './Turma';
import { DeckSummary, TourDeck, type Decision, type DeckGroup } from './TourDeck';
import s from './montar.module.css';
import m from '../components/money/money.module.css';
import type { MapExtra, MapStop } from '../components/map/RouteMap';

const RouteMap = dynamic(() => import('../components/map/RouteMap'), { ssr: false, loading: () => <div className="skel" style={{ height: 320, borderRadius: 22 }} /> });

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
const MARKS: { value: PlaceMark; label: string; icon: IconName }[] = [
  { value: 'must', label: 'Indispensável', icon: 'heart' },
  { value: 'maybe', label: 'Talvez', icon: 'sparkle' },
  { value: 'skip', label: 'Pular', icon: 'close' },
];
const STEP_NAMES: Record<OnboardingStep, string> = { 2: 'Gostos', 3: 'Lugares', 4: 'Roteiro', 5: 'Passeios', 6: 'Custo' };
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

  // Navegação livre: qualquer passo já alcançado (e Passeios/Custo quando o roteiro já existe) pode ser reaberto.
  const reached = Math.max(ob.step, step);
  const canGo = (n: OnboardingStep) => n !== step && (n <= reached || (n >= 5 && b.stops.length > 0));
  const common = { b, ob, persist, go, busy, run, money, online, manual };
  return (
    <div className="wrap">
      <div className={s.page}>
        <ScreenHeader back={base || '/'} title="Montar a viagem" subtitle={`${b.trip.destinations.join(', ') || b.trip.title} · ${nightsOf(b.trip) + 1} dias`} />
        <div className={s.top}>
          <div className={s.topRow}><span>Passo {step} de 6</span><button type="button" className={s.skip} onClick={later} disabled={busy}>Montar depois</button></div>
          <nav className={s.steps} aria-label="Passos da montagem">
            {([2, 3, 4, 5, 6] as const).map((n) => (
              <button
                key={n} type="button" className={s.stepBtn} aria-current={n === step ? 'step' : undefined} data-done={n < reached || (n >= 5 && b.stops.length > 0 && n !== step) ? 'true' : undefined}
                disabled={busy || (!canGo(n) && n !== step)} onClick={() => canGo(n) && go(n)} aria-label={`Passo ${n}: ${STEP_NAMES[n]}`}
              >
                <i aria-hidden="true" /><span>{STEP_NAMES[n]}</span>
              </button>
            ))}
          </nav>
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
    budget: b.trip.budget_total != null && Number(b.trip.budget_total) > 0 ? Math.round(Number(b.trip.budget_total) * 100 / people) / 100 : null,
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
        <MoneyInput label="Teto por pessoa (opcional)" currency={b.trip.base_currency} value={p.budget ? Math.round(p.budget * 100) : null} onChange={(c) => setP({ ...p, budget: c ? c / 100 : null })} hint="Com teto, a Trilha avisa quando a viagem passar dele." />
        <Button disabled={busy || !p.vibes.length} onClick={next}>{busy ? <Busy>Salvando</Busy> : 'Continuar'}</Button>
      </ChatOptions>
    </StepChat>
  );
}

// ───────────── Passo 3 · O que não pode faltar ─────────────

/** Escolha com ícone e cor (planning §10.5): Indispensável (verde), Talvez (azul), Pular (cinza). */
function MarkPicker({ value, onChange, label }: { value: PlaceMark; onChange: (m: PlaceMark) => void; label: string }) {
  const key = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + MARKS.length) % MARKS.length;
    onChange(MARKS[n].value);
    (e.currentTarget.parentElement?.children[n] as HTMLElement | undefined)?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className={s.marks}>
      {MARKS.map((m, i) => (
        <button key={m.value} type="button" role="radio" aria-checked={value === m.value} tabIndex={value === m.value ? 0 : -1} data-mark={m.value} className={s.mark} onClick={() => onChange(m.value)} onKeyDown={(e) => key(e, i)}>
          <Icon name={m.icon} size={16} />{m.label}
        </button>
      ))}
    </div>
  );
}

const nightsText = (a: number, b: number) => (a === b ? `${a} noite${a > 1 ? 's' : ''}` : `${a} a ${b} noites`);
const hoursText = (h: number) => (h < 1 ? `${Math.round(h * 60)} min` : `${String(Math.round(h * 10) / 10).replace('.', ',')}h`);
const tagLabel = (t: string) => VIBES.find((v) => v.id === t)?.label ?? t;

/** Ponto turístico na janela de detalhes, com foto quando a Wikimedia tiver (busca "Atração, Cidade"). */
function Attraction({ a, place, photo }: { a: PlaceAttraction; place: string; photo: boolean }) {
  const resolved = useResolvedPhoto(null, photo ? `${a.name}, ${place}` : null, photo);
  return (
    <li className={s.attraction}>
      <Photo photo={resolved as PhotoData | null} place={a.name} alt="" height={64} caption={false} className={s.attractionPhoto} />
      <span><b>{a.name}</b>{a.why ? <small>{a.why}</small> : null}</span>
    </li>
  );
}

/** Janela dedicada ao lugar: foto grande, por que ir, o que ver, dica e (no rodapé) a escolha ou as ações. */
function PlaceSheet({ open, onClose, name, sub, query, why, attractions, tip, tags, facts, footer, loading, children }: {
  open: boolean; onClose: () => void; name: string; sub: string; query: string[]; why: string; attractions: PlaceAttraction[];
  tip?: string | null; tags?: string[]; facts: React.ReactNode; footer?: React.ReactNode; loading?: boolean; children?: React.ReactNode;
}) {
  const photo = useResolvedPhoto(null, open ? query : null, open);
  return (
    <Sheet open={open} onClose={onClose} title={name} description={sub} size="lg" footer={footer}>
      <div className={s.sheetBody}>
        <Photo photo={photo as PhotoData | null} place={name} alt={`Foto de ${name}`} height={240} />
        <div className={s.facts}>{facts}</div>
        {why ? <p className={s.why}>{why}</p> : null}
        {children}
        {loading ? <p className={s.muted} role="status"><Busy>A Trilha está buscando o resumo e o que ver</Busy></p> : null}
        {tags?.length ? <div className={s.chips}>{tags.map((t) => <Badge key={t}>{tagLabel(t)}</Badge>)}</div> : null}
        {attractions.length ? (
          <section aria-label={`O que ver em ${name}`} className={s.stack}>
            <h3 className={s.label}>O que ver</h3>
            <ul className={s.attractions}>{attractions.map((a) => <Attraction key={a.name} a={a} place={name} photo={open} />)}</ul>
          </section>
        ) : null}
        {tip ? <p className={s.tip}><Icon name="sparkle" size={16} /> {tip}</p> : null}
        <p className={s.muted}>Sugestões da Trilha. Horários, preços e regras de entrada mudam: confira antes de ir.</p>
      </div>
    </Sheet>
  );
}

function PlaceCard({ p, mark, onMark, loading = false }: { p: PlaceIdea; mark: PlaceMark; onMark: (m: PlaceMark) => void; loading?: boolean }) {
  const [open, setOpen] = useState(false);
  // "Nara, Japão" ajuda a busca a achar a cidade (e não a cantora); o termo da IA fica de reserva.
  const query = [p.country ? `${p.name}, ${p.country}` : p.name, p.name, p.photo_query ?? ''];
  const resolved = useResolvedPhoto(null, query, true);
  const sights = p.attractions?.length ? p.attractions : (p.highlights ?? []).map((name) => ({ name }));
  return (
    <article className={s.place} data-place={p.name} data-mark={mark}>
      <button type="button" className={s.photoBtn} onClick={() => setOpen(true)} aria-label={`Ver detalhes de ${p.name}`}>
        <Photo photo={resolved as PhotoData | null} place={p.name} alt="" height={140} caption={false} />
      </button>
      <div className={s.placeHead}>
        <h3>{p.name}</h3>
        <IconButton icon="info" label={`Mais sobre ${p.name}`} size={40} variant="ghost" onClick={() => setOpen(true)} />
      </div>
      <small className={s.muted}>{[p.kind === 'experiencia' ? `Experiência${p.base ? ` · sai de ${p.base}` : ''}` : p.region, p.kind === 'experiencia' ? null : nightsText(p.nights_min, p.nights_max)].filter(Boolean).join(' · ')}</small>
      {loading ? <p className={s.muted} role="status"><Busy>Buscando resumo, foto e o que ver</Busy></p> : <p className={s.why}>{p.why}</p>}
      {sights.length ? <ul className={s.highlights}>{sights.slice(0, 3).map((h) => <li key={h.name}>{h.name}</li>)}</ul> : null}
      <MarkPicker label={`${p.name}: quanto quer ir`} value={mark} onChange={onMark} />
      <PlaceSheet
        open={open} onClose={() => setOpen(false)} name={p.name} sub={[p.region, p.country].filter(Boolean).join(', ')} query={query}
        why={p.why} attractions={sights} tip={p.tip} tags={p.tags} loading={loading}
        footer={<MarkPicker label={`${p.name}: quanto quer ir`} value={mark} onChange={onMark} />}
        facts={<>{p.kind === 'experiencia' ? <Badge>experiência{p.base ? ` · sai de ${p.base}` : ''}</Badge> : <Badge>{nightsText(p.nights_min, p.nights_max)}</Badge>}{p.country ? <Badge>{p.country}</Badge> : null}</>}
      />
    </article>
  );
}

function NearbyCard({ n, mark, onMark, money }: { n: NearbyIdea; mark: PlaceMark; onMark: (m: PlaceMark) => void; money: (v: number) => string }) {
  const [open, setOpen] = useState(false);
  const query = [n.country ? `${n.name}, ${n.country}` : n.name, n.name, n.photo_query ?? ''];
  const resolved = useResolvedPhoto(null, query, true);
  const how = `${hoursText(n.hours)} de ${MODE_LABEL[n.mode as TransportMode]?.toLowerCase() ?? 'viagem'} de ${n.from}`;
  return (
    <article className={s.place} data-nearby={n.name} data-mark={mark}>
      <button type="button" className={s.photoBtn} onClick={() => setOpen(true)} aria-label={`Ver detalhes de ${n.name}`}>
        <Photo photo={resolved as PhotoData | null} place={n.name} alt="" height={110} caption={false} />
      </button>
      <div className={s.placeHead}>
        <h3>{n.name}{n.country ? <small> · {n.country}</small> : null}</h3>
        <IconButton icon="info" label={`Mais sobre ${n.name}`} size={40} variant="ghost" onClick={() => setOpen(true)} />
      </div>
      <p className={s.muted}>{n.kind === 'bate_volta' ? 'Bate-volta' : 'Pede 1 noite'} · {how} · ≈ {money(n.cost_low)}–{money(n.cost_high)} por pessoa <EstimateBadge /></p>
      <p className={s.why}>{n.why}</p>
      <MarkPicker label={`${n.name}: quanto quer ir`} value={mark} onChange={onMark} />
      <PlaceSheet
        open={open} onClose={() => setOpen(false)} name={n.name} sub={`${n.country} · perto de ${n.from}`} query={query}
        why={n.why} attractions={n.attractions ?? []} tip={n.tip}
        footer={<MarkPicker label={`${n.name}: quanto quer ir`} value={mark} onChange={onMark} />}
        facts={<><Badge>{n.kind === 'bate_volta' ? 'bate-volta' : 'pede 1 noite'}</Badge><Badge>{how}</Badge><Badge>≈ {money(n.cost_low)}–{money(n.cost_high)} por pessoa</Badge></>}
      />
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
  // Lugares adicionados à mão (e os que vieram do Descobrir) ganham resumo, foto e o que ver, como as sugestões.
  const [enriching, setEnriching] = useState<Set<string>>(new Set());
  const tried = useRef(new Set<string>());
  const obRef = useRef(ob);
  obRef.current = ob;
  const marksRef = useRef(marks);
  marksRef.current = marks;
  const enrich = async (names: string[]) => {
    const todo = names.filter((n) => !tried.current.has(placeKey(n))).slice(0, 8);
    if (!todo.length) return;
    for (const n of todo) tried.current.add(placeKey(n));
    setEnriching((e) => new Set([...e, ...todo.map(placeKey)]));
    const r = await callAi<{ items: (PlaceInfo & { asked: string })[] }>('explore', { kind: 'place_info', tripId: b.trip.id, items: todo.map((name) => ({ name })) });
    setEnriching((e) => { const n = new Set(e); for (const x of todo) n.delete(placeKey(x)); return n; });
    const cur = obRef.current;
    if (!r?.data.items.length || !cur.places) return;
    const next = applyPlaceInfo(cur.places.items, marksRef.current, r.data.items);
    marksRef.current = next.marks;
    setMarks(next.marks);
    await persist({ ...cur, places: { ...cur.places, items: next.items }, marks: next.marks }).catch(() => undefined);
  };
  useEffect(() => {
    if (places && online) void enrich(needsInfo(places.items));
  }, [places, online]); // eslint-disable-line react-hooks/exhaustive-deps

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
    await persist({ ...ob, places: { items, nearby: r.res.data.nearby, fetched_at: new Date().toISOString() }, marks: nextMarks, step: Math.max(3, ob.step) as OnboardingStep }).catch(() => undefined);
  };
  useEffect(() => {
    if (!places && !asked.current && online) { asked.current = true; void fetchPlaces(); }
  }, [places, online]); // eslint-disable-line react-hooks/exhaustive-deps

  if (fail) return <AiFailed fail={fail} retry={() => void fetchPlaces()} manual={manual} />;
  if (!places || loading) {
    return (
      <StepChat label="O que não pode faltar">
        <AiThinking steps={AI_STEPS.places} title="A IA está escolhendo lugares" lines={0} />
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
    await persist({ ...ob, marks, wishes, step: Math.max(4, ob.step) as OnboardingStep, stale: changed && ob.route ? [...new Set([...(ob.stale ?? []), 'route' as const])] : ob.stale });
    go(4);
  });

  return (
    <StepChat label="O que não pode faltar">
      <TrilhaBubble step="3 · Lugares">Separei lugares que combinam com vocês. <b>O que não pode faltar?</b></TrilhaBubble>
      <ChatOptions>
        <div className={s.grid}>{items.map((p) => <PlaceCard key={p.name} p={p} mark={marks[placeKey(p.name)] ?? 'maybe'} onMark={mark(p.name)} loading={enriching.has(placeKey(p.name))} />)}</div>
        <div className={s.wishRow}>
          <Field label="Adicionar um lugar"><input value={extra} maxLength={80} placeholder="Ex.: Lucca" onChange={(e) => setExtra(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPlace(); } }} /></Field>
          <Button variant="secondary" onClick={addPlace} disabled={!extra.trim()}>Adicionar</Button>
        </div>
        {nearby.length ? (
          <>
            <h2 className={s.label}>Perto daqui</h2>
            <p className={s.muted}>Lugares que ficam perto dos que você viu acima, inclusive em países vizinhos. Muita gente não sabe que dá pra ir.</p>
            <div className={s.grid}>{nearby.map((n) => <NearbyCard key={n.name} n={n} money={money} mark={marks[placeKey(n.name)] ?? 'maybe'} onMark={mark(n.name)} />)}</div>
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

const MODE_ICON: Partial<Record<TransportMode, IconName>> = { plane: 'plane', train: 'train', bus: 'bus' };
const FEEDBACK_IDEAS = ['Menos dias na primeira cidade', 'Quero mais praia', 'Terminar a viagem em Roma', 'Trocar uma cidade por bate-volta'];

/** Trecho entre paradas: ícone do meio, duração e preço por pessoa. */
function LegLine({ leg, money }: { leg: RouteLeg | null; money: (v: number) => string }) {
  if (!leg) return null;
  const price = leg.cost_low != null && leg.cost_high != null ? Math.round((leg.cost_low + leg.cost_high) / 2) : null;
  return (
    <div className={s.leg}>
      <span className={s.legIcon} aria-hidden="true"><Icon name={MODE_ICON[leg.mode] ?? 'route'} size={16} /></span>
      <span className={s.legText}>{MODE_LABEL[leg.mode] ?? 'Trecho'} {leg.from} → {leg.to}{leg.hours ? ` · ${hoursText(leg.hours)}` : ''}</span>
      {price != null ? <span className={s.legPrice}>≈ {money(price)} <EstimateBadge /></span> : <span className={s.legPrice}>preço no Orçamento</span>}
    </div>
  );
}

const ORIGIN: Record<string, { label: string; icon: IconName; tone: 'ok' | 'brand' | 'neutral' | 'sun' }> = {
  must: { label: 'Indispensável', icon: 'heart', tone: 'ok' },
  maybe: { label: 'Talvez', icon: 'sparkle', tone: 'brand' },
  skip: { label: 'Você pulou', icon: 'close', tone: 'neutral' },
  nearby: { label: 'Perto daqui', icon: 'pin', tone: 'sun' },
  added: { label: 'Você adicionou', icon: 'plus', tone: 'ok' },
  trilha: { label: 'Sugestão da Trilha', icon: 'sparkle', tone: 'neutral' },
};
/** Selo de onde veio o lugar: como a pessoa marcou no passo 3, ou sugestão nova da Trilha. */
function OriginBadge({ name, places, marks }: { name: string; places: OnboardingState['places']; marks: Record<string, PlaceMark> }) {
  const o = markOf(name, places, marks);
  const key = o.added ? 'added' : o.mark === 'must' ? 'must' : o.nearby && o.mark !== 'skip' ? 'nearby' : o.mark ?? 'trilha';
  const v = ORIGIN[key];
  return <span className={s.origin} data-tone={v.tone}><Icon name={v.icon} size={13} />{v.label}</span>;
}

type InfoMap = Record<string, PlaceInfo>;
const stopId = (name: string) => `s:${placeKey(name)}`;
const tripMark = (stop: string, name: string) => `t:${placeKey(stop)}:${placeKey(name)}`;
const outId = (name: string) => `o:${placeKey(name)}`;
const photoQuery = (name: string, info: PlaceInfo | null, country?: string | null) => {
  const c = info?.country || country;
  return [c ? `${info?.name ?? name}, ${c}` : info?.name ?? name, info?.name ?? name, info?.photo_query ?? ''];
};
const scrollToStop = (name: string) => {
  if (typeof document === 'undefined') return;
  const el = [...document.querySelectorAll<HTMLElement>('[data-stop]')].find((x) => placeKey(x.dataset.stop ?? '') === placeKey(name));
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
};

/**
 * Resumos sob demanda (paradas sugeridas, bate-voltas, "ficou de fora"): uma chamada `place_info` por lote,
 * guardada em `onboarding.info` para não pedir de novo.
 */
function usePlaceInfo(tripIdValue: string, ob: OnboardingState, persist: StepProps['persist'], online: boolean) {
  const [info, setInfo] = useState<InfoMap>(ob.info ?? {});
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const infoRef = useRef(info);
  const obRef = useRef(ob);
  obRef.current = ob;
  const tried = useRef(new Set<string>());
  const load = async (items: { name: string; near?: string | null }[]) => {
    const todo = items.filter((i) => !tried.current.has(placeKey(i.name))).slice(0, 8);
    if (!todo.length || !online) return;
    for (const i of todo) tried.current.add(placeKey(i.name));
    setLoading((l) => new Set([...l, ...todo.map((i) => placeKey(i.name))]));
    const r = await callAi<{ items: (PlaceInfo & { asked: string })[] }>('explore', { kind: 'place_info', tripId: tripIdValue, items: todo });
    setLoading((l) => { const n = new Set(l); for (const i of todo) n.delete(placeKey(i.name)); return n; });
    if (!r?.data.items.length) return;
    const next = { ...infoRef.current };
    for (const { asked, ...rest } of r.data.items) {
      next[placeKey(asked)] = rest;
      next[placeKey(rest.name)] = rest;
    }
    infoRef.current = next;
    setInfo(next);
    await persist({ ...obRef.current, info: next }).catch(() => undefined);
  };
  return { info, loading, load };
}

/** Selo "Seu pedido": o desejo do passo 3 que a Trilha encaixou nesta parada. */
function WishHere({ wish, how, dayTrip }: { wish: string; how: string | null; dayTrip: string | null }) {
  return (
    <div className={s.wishHere}>
      <Icon name="heart" size={15} />
      <span><b>{wish} · você escolheu</b>{how || dayTrip ? <small>{how ?? `Bate-volta: ${dayTrip}`}</small> : null}</span>
    </div>
  );
}

function StopCard({ st, i, count, dates, cost, money, places, marks, info, wishes, onNights, onMove, onRemove, onOpen, onTrip }: {
  st: RouteStop; i: number; count: number; dates: { arrival: string; departure: string }; cost: StopCost; money: (v: number) => string;
  places: OnboardingState['places']; marks: Record<string, PlaceMark>; info: PlaceInfo | null;
  wishes: { wish: string; how: string | null; dayTrip: string | null }[];
  onNights: (d: 1 | -1) => void; onMove: (d: 1 | -1) => void; onRemove: () => void; onOpen: () => void; onTrip: (name: string) => void;
}) {
  const photo = useResolvedPhoto(null, photoQuery(st.name, info, st.country), true);
  const summary = info?.why && !/^Você adicionou\.?$|^Estava no roteiro/.test(info.why) ? info.why : st.why;
  const sights = (info?.attractions?.length ? info.attractions.map((a) => a.name) : info?.highlights ?? []).slice(0, 3);
  return (
    <article className={s.stopCard} data-stop={st.name}>
      <div className={s.stopTop}>
        <button type="button" className={s.photoBtn} onClick={onOpen} aria-label={`Ver detalhes de ${st.name}`}>
          <Photo photo={photo as PhotoData | null} place={st.name} alt="" height={84} caption={false} className={s.stopPhoto} />
        </button>
        <div className={s.stopInfo}>
          <span className={s.stopNum}>{i + 1}</span>
          <h3>{st.name}</h3>
          <small>{st.country ? `${st.country} · ` : ''}{dayMonth(dates.arrival)} a {dayMonth(dates.departure)}</small>
          <OriginBadge name={st.name} places={places} marks={marks} />
        </div>
      </div>
      {summary ? <p className={s.stopWhy}>{summary}</p> : null}
      {sights.length ? <p className={s.stopSights}><Icon name="sparkle" size={13} /> {sights.join(' · ')}</p> : null}
      <button type="button" className={s.more} onClick={onOpen}>Ver mais sobre {st.name} <Icon name="next" size={14} /></button>
      {wishes.map((w) => <WishHere key={w.wish} {...w} />)}
      <div className={s.stopRow}>
        <div className={s.stepper} role="group" aria-label={`Noites em ${st.name}`}>
          <button type="button" className={s.ctl} aria-label={`Uma noite a menos em ${st.name}`} disabled={st.nights <= 1} onClick={() => onNights(-1)}>−</button>
          <span className={s.nights} aria-label={`${st.nights} noites em ${st.name}`}><Icon name="bed" size={15} />{st.nights}</span>
          <button type="button" className={s.ctl} aria-label={`Uma noite a mais em ${st.name}`} onClick={() => onNights(1)}>+</button>
        </div>
        <div className={s.stopMove}>
          <button type="button" className={s.ctl} aria-label={`Subir ${st.name}`} disabled={i === 0} onClick={() => onMove(-1)}>↑</button>
          <button type="button" className={s.ctl} aria-label={`Descer ${st.name}`} disabled={i === count - 1} onClick={() => onMove(1)}>↓</button>
          <button type="button" className={s.ctl} aria-label={`Tirar ${st.name}`} disabled={count <= 1} onClick={onRemove}>✕</button>
        </div>
      </div>
      <div className={s.stopCost} aria-label={`Custo por pessoa em ${st.name}`}>
        <b>≈ {money(cost.total)} <small>por pessoa aqui</small></b>
        <span className={s.costChips}>
          <span><Icon name="bed" size={14} />{money(cost.stay)}</span>
          <span><Icon name="wallet" size={14} />comida {money(cost.food)}</span>
          {cost.trips ? <span><Icon name="route" size={14} />bate-volta {money(cost.trips)}</span> : null}
        </span>
      </div>
      {st.day_trips.length ? (
        <div className={s.chips}>
          {st.day_trips.map((d) => (
            <button key={d.name} type="button" className={s.tripChip} data-wish={d.wish ? 'true' : undefined} onClick={() => onTrip(d.name)} aria-label={`O que é ${d.name} (bate-volta, dia ${d.day_offset + 1})`}>
              {d.wish ? <Icon name="heart" size={13} /> : null}Bate-volta: {d.name} · dia {d.day_offset + 1}<Icon name="info" size={14} />
            </button>
          ))}
        </div>
      ) : null}
    </article>
  );
}

type RouteSheetState = { type: 'stop'; name: string } | { type: 'trip'; stop: string; name: string } | { type: 'out'; name: string } | null;

function StepRoute({ b, ob, persist, go, busy, run, money, online, manual }: StepProps) {
  const { source, accent } = useBundle();
  const confirm = useConfirm();
  const [fail, setFail] = useState<AiFail>(null);
  const [loading, setLoading] = useState(false);
  const [route, setRoute] = useState<RouteProposal | null>(ob.route ?? null);
  const [replace, setReplace] = useState(false);
  const [err, setErr] = useState('');
  const [feedback, setFeedback] = useState('');
  const [sheet, setSheet] = useState<RouteSheetState>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const asked = useRef(false);
  const nights = nightsOf(b.trip);
  const places = ob.places ?? { items: [], nearby: [] };
  const marks = ob.marks ?? {};
  const stale = ob.stale?.includes('route');
  const calls = ob.route_calls ?? 0;
  const style = ob.prefs?.stay ?? b.trip.budget_plan?.style ?? 'equilibrado';
  const { info, loading: infoLoading, load } = usePlaceInfo(b.trip.id, ob, persist, online);
  const about = (name: string) => infoOf(name, places, info);
  const coordOf = (name: string, lat?: number | null, lng?: number | null): [number, number] | null => {
    if (lat != null && lng != null && (lat !== 0 || lng !== 0)) return [lat, lng];
    const i = about(name).info;
    return i?.lat != null && i.lng != null && (i.lat !== 0 || i.lng !== 0) ? [i.lat, i.lng] : null;
  };

  // Mapa: paradas em ordem, bate-voltas ligados à parada e o que ficou de fora (tracejado).
  const mapKey = JSON.stringify([route?.stops.map((x) => [x.name, x.lat, x.lng, x.day_trips.map((d) => [d.name, d.lat, d.lng])]), route?.left_out.map((l) => [l.name, l.lat, l.lng, l.reason]), Object.keys(info).length]);
  const { mapStops, extras } = useMemo(() => {
    if (!route) return { mapStops: [] as MapStop[], extras: [] as MapExtra[] };
    const mapStops: MapStop[] = route.stops.map((x) => { const c = coordOf(x.name, x.lat, x.lng); return { id: stopId(x.name), name: x.name, lat: c?.[0] ?? null, lng: c?.[1] ?? null }; });
    const extras: MapExtra[] = [];
    for (const x of route.stops) {
      for (const d of x.day_trips) {
        const c = coordOf(d.name, d.lat, d.lng);
        if (c) extras.push({ id: tripMark(x.name, d.name), name: d.name, lat: c[0], lng: c[1], kind: 'trip', from: stopId(x.name), note: `Bate-volta saindo de ${x.name}` });
      }
    }
    for (const l of route.left_out) {
      const c = coordOf(l.name, l.lat, l.lng);
      if (c) extras.push({ id: outId(l.name), name: l.name, lat: c[0], lng: c[1], kind: 'out', note: `Ficou de fora: ${l.reason}` });
    }
    return { mapStops, extras };
  }, [mapKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchRoute = async (opts: { variant?: 'calmo' | 'mais_lugares'; force?: string[]; feedback?: string } = {}) => {
    if (calls >= MAX_ROUTE_CALLS) return;
    setFail(null);
    setLoading(true);
    setSheet(null);
    setFocus(null);
    const body = {
      kind: 'route', tripId: b.trip.id,
      must: namesBy('must', places.items, places.nearby, marks), maybe: namesBy('maybe', places.items, places.nearby, marks),
      skip: namesBy('skip', places.items, places.nearby, marks), wishes: ob.wishes ?? [], variant: opts.variant ?? null, force: opts.force,
      feedback: opts.feedback || undefined,
      // O roteiro como está na tela (com as edições) serve de base para qualquer ajuste.
      current: route?.stops.map((x) => ({ name: x.name, nights: Math.max(1, x.nights) })),
    };
    const r = await callAiOrError<{ route: RouteProposal }>('explore', body);
    setLoading(false);
    if (!r.ok) { setFail({ unavailable: r.status === 503, error: r.error }); return; }
    setRoute(r.res.data.route);
    if (opts.feedback) setFeedback('');
    await persist({ ...ob, route: r.res.data.route, route_calls: calls + 1, stale: (ob.stale ?? []).filter((x) => x !== 'route') }).catch(() => undefined);
  };
  useEffect(() => {
    if ((!route || stale) && !asked.current && online) { asked.current = true; void fetchRoute(); }
  }, [route, stale, online]); // eslint-disable-line react-hooks/exhaustive-deps

  // Uma vez por rota: busca as coordenadas dos bate-voltas e dos que ficaram de fora que a IA não mandou (para o mapa).
  useEffect(() => {
    if (!route) return;
    const want = [
      ...route.stops.flatMap((x) => x.day_trips.filter((d) => !coordOf(d.name, d.lat, d.lng)).map((d) => ({ name: d.name, near: x.name }))),
      ...route.left_out.filter((l) => !coordOf(l.name, l.lat, l.lng)).map((l) => ({ name: l.name })),
    ];
    if (want.length) void load(want);
  }, [route?.generated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  if (fail) return <AiFailed fail={fail} retry={() => void fetchRoute()} manual={manual} />;
  if (!route || loading) {
    return (
      <StepChat label="Roteiro sugerido">
        <AiThinking steps={AI_STEPS.route} title={feedback ? 'A IA está ajustando a rota' : 'A IA está montando a rota'} lines={0} />
      </StepChat>
    );
  }

  const dates = datesFor(route, b.trip.start_date);
  const fallbackNight = nightFor(style);
  const fallbackFood = foodLevels().medio;
  const costs = route.stops.map((st) => stopCost(st, style, route.food_pp_day, fallbackNight, fallbackFood));
  const total = routeCost(route, style, fallbackNight, fallbackFood);
  const legsTotal = total.legs;
  const mustNames = new Set(namesBy('must', places.items, places.nearby, marks).map(placeKey));
  // "Perto daqui" que a rota não usou (nem como parada, nem como bate-volta): atalho para incluir.
  const used = new Set(route.stops.flatMap((x) => [placeKey(x.name), ...x.day_trips.map((d) => placeKey(d.name))]));
  const skippedNearby = places.nearby.filter((n) => !used.has(placeKey(n.name))).slice(0, 3);
  const edit = (r: RouteProposal) => setRoute(r);
  const remove = async (i: number) => {
    const st = route.stops[i];
    if (mustNames.has(placeKey(st.name)) && !(await confirm({ title: `Tirar ${st.name}?`, message: `${st.name} estava marcado como indispensável. As noites vão para as outras cidades.`, confirmLabel: 'Tirar do roteiro' }))) return;
    edit(removeStop(route, i, nights));
  };
  const canAsk = calls < MAX_ROUTE_CALLS && online;
  const sendFeedback = () => { const f = feedback.trim(); if (f && canAsk) void fetchRoute({ feedback: f }); };
  const missingWishes = route.wishes.filter((w) => !w.stop);
  const missingMust = route.left_out.filter((l) => mustNames.has(placeKey(l.name)) || markOf(l.name, places, marks).added);
  const notFit = missingWishes.length + missingMust.length;

  const openSheet = (x: NonNullable<RouteSheetState>, near?: string) => {
    setSheet(x);
    if (!about(x.name).detailed) void load([{ name: x.name, near: near ?? null }]);
  };
  const showOnMap = (id: string, name: string) => {
    setFocus(id);
    if (!coordOf(name)) void load([{ name }]);
    mapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const openExtra = (id: string) => {
    for (const x of route.stops) for (const d of x.day_trips) if (tripMark(x.name, d.name) === id) return openSheet({ type: 'trip', stop: x.name, name: d.name }, x.name);
    const l = route.left_out.find((o) => outId(o.name) === id);
    if (l) openSheet({ type: 'out', name: l.name });
  };
  const fitWish = (w: { wish: string; sacrifice?: string | null }) => fetchRoute({ feedback: `Encaixe o desejo "${w.wish}" no roteiro${w.sacrifice ? `, sacrificando: ${w.sacrifice}` : ', tirando o que for preciso'}.` });

  const apply = (force = false) => run(async () => {
    setErr('');
    const rows = routeToRows(route, b.trip);
    const range = foodByCountry(route.stops.map((x) => ({ country: x.country, nights: x.nights })), route.food_pp_day);
    const prev = b.trip.budget_plan;
    const plan: BudgetPlan = {
      ...(prev ?? {}),
      style,
      pace: ob.prefs?.pace ?? prev?.pace ?? 'moderado',
      stay_estimates: stayEstimatesOf(route, rows.stops.map((x) => x.id)),
      food: 'medio',
      food_range: range,
      daily_food_cents: foodLevels(range).medio,
      transport_cents: {},
      activities: undefined,
    };
    const next: OnboardingState = { ...ob, info, route, step: 5, tours: {}, tour_pick: [], tours_applied: false, stale: [] };
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

  // Janela do lugar aberto (parada, bate-volta ou "ficou de fora").
  const sheetView = (() => {
    if (!sheet) return null;
    const a = about(sheet.name);
    const i = a.info;
    const isLoading = infoLoading.has(placeKey(sheet.name)) && !a.detailed;
    const why = i?.why && !/^Você adicionou\.?$|^Estava no roteiro/.test(i.why) ? i.why : '';
    const base = { open: true, onClose: () => setSheet(null), name: i?.name ?? sheet.name, query: photoQuery(sheet.name, i), attractions: i?.attractions ?? [], tip: i?.tip ?? null, tags: i?.tags, loading: isLoading };
    if (sheet.type === 'stop') {
      const idx = route.stops.findIndex((x) => x.name === sheet.name);
      const st = route.stops[idx];
      if (!st) return null;
      const here = wishesAt(route, st);
      return (
        <PlaceSheet
          {...base} sub={[i?.region, st.country].filter(Boolean).join(', ')} why={why || st.why || ''}
          facts={<><Badge>parada {idx + 1}</Badge><Badge>{nightsText(st.nights, st.nights)}</Badge><Badge>{dayMonth(dates[idx].arrival)} a {dayMonth(dates[idx].departure)}</Badge></>}
          footer={<div className={s.actions}><Button size="sm" variant="secondary" onClick={() => { setSheet(null); showOnMap(stopId(st.name), st.name); }}><Icon name="pin" size={15} /> Ver no mapa</Button></div>}
        >
          {here.map((w) => <WishHere key={w.wish} {...w} />)}
          {st.day_trips.length ? (
            <section className={s.stack} aria-label={`Bate-voltas saindo de ${st.name}`}>
              <h3 className={s.label}>Bate-voltas daqui</h3>
              <div className={s.chips}>{st.day_trips.map((d) => <button key={d.name} type="button" className={s.tripChip} onClick={() => openSheet({ type: 'trip', stop: st.name, name: d.name }, st.name)}>{d.name} · dia {d.day_offset + 1}<Icon name="info" size={14} /></button>)}</div>
            </section>
          ) : null}
        </PlaceSheet>
      );
    }
    if (sheet.type === 'trip') {
      const st = route.stops.find((x) => x.name === sheet.stop);
      const d = st?.day_trips.find((x) => x.name === sheet.name);
      if (!st || !d) return null;
      const price = Math.round((d.cost_low + d.cost_high) / 2);
      return (
        <PlaceSheet
          {...base} sub={`Bate-volta saindo de ${st.name}`} why={d.why || why}
          facts={<><Badge>bate-volta · dia {d.day_offset + 1} em {st.name}</Badge>{price ? <Badge>≈ {money(price)} por pessoa</Badge> : null}{i?.country ? <Badge>{i.country}</Badge> : null}</>}
          footer={<div className={s.actions}><Button size="sm" variant="secondary" onClick={() => { setSheet(null); showOnMap(tripMark(st.name, d.name), d.name); }}><Icon name="pin" size={15} /> Ver no mapa</Button></div>}
        >
          {d.wish ? <WishHere wish={d.wish} how={route.wishes.find((w) => placeKey(w.wish) === placeKey(d.wish ?? ''))?.how ?? null} dayTrip={null} /> : null}
        </PlaceSheet>
      );
    }
    const l = route.left_out.find((x) => x.name === sheet.name);
    if (!l) return null;
    return (
      <PlaceSheet
        {...base} sub={[i?.region, i?.country].filter(Boolean).join(', ') || 'Ficou de fora do roteiro'} why={why}
        facts={<><OriginBadge name={l.name} places={ob.places} marks={marks} />{i?.nights_max ? <Badge>{nightsText(Math.max(1, i.nights_min ?? 1), i.nights_max)}</Badge> : null}</>}
        footer={(
          <div className={s.actions}>
            <Button size="sm" variant="secondary" onClick={() => { setSheet(null); showOnMap(outId(l.name), l.name); }}><Icon name="pin" size={15} /> Ver no mapa</Button>
            {canAsk ? <Button size="sm" disabled={busy} onClick={() => void fetchRoute({ force: [l.name] })}>Incluir no roteiro</Button> : null}
          </div>
        )}
      >
        <div className={s.outWhy}>
          <p><b>Por que ficou de fora:</b> {l.reason}</p>
          {l.sacrifice ? <p><b>Pra caber:</b> {l.sacrifice}</p> : null}
        </div>
      </PlaceSheet>
    );
  })();

  return (
    <StepChat label="Roteiro sugerido">
      <TrilhaBubble step="4 · Roteiro">
        Montei {nights} noites com os seus indispensáveis. <b>Mexa no que quiser</b>, ou peça um ajuste lá embaixo.
        {notFit ? <> <b>{notFit === 1 ? '1 pedido seu não coube' : `${notFit} pedidos seus não couberam`}</b>: veja abaixo o motivo e o que dá pra trocar.</> : null}
      </TrilhaBubble>
      <ChatOptions>
        <section className={m.summary} aria-label="Resumo do roteiro">
          <div className={m.row}>
            <div><small>Roteiro</small><br /><strong>{route.stops.length} cidades · {nights} noites</strong></div>
            <div><small>Por pessoa</small><br /><b data-testid="route-total">≈ {money(total.total)}</b></div>
          </div>
          <EstimateBadge />
          <div className={s.lines}>
            <div className={s.line}><span>Transporte · {[route.outbound, ...route.legs, route.return].filter(Boolean).length} trechos</span><span>{money(legsTotal)}</span></div>
            <div className={s.line}><span>Hospedagem, comida e bate-voltas nas paradas</span><span>{money(total.stops)}</span></div>
          </div>
          {total.pendingLegs ? <small>{total.pendingLegs} trecho(s) sem preço ainda: entram no Orçamento.</small> : null}
        </section>

        <section className={s.mapBox} aria-labelledby="route-map" ref={mapRef}>
          <h2 id="route-map" className={s.label}>A rota no mapa</h2>
          <RouteMap
            stops={mapStops} extras={extras} accent={accent} height="min(52vh, 380px)" focusId={focus} label="Mapa da rota sugerida"
            onOpen={(id) => { const st = route.stops.find((x) => stopId(x.name) === id); if (st) openSheet({ type: 'stop', name: st.name }); }}
            onOpenExtra={openExtra}
          />
          <p className={s.mapLegend}>
            <span><i data-k="stop" /> paradas em ordem</span>
            {extras.some((x) => x.kind === 'trip') ? <span><i data-k="trip" /> bate-voltas</span> : null}
            {extras.some((x) => x.kind === 'out') ? <span><i data-k="out" /> ficou de fora</span> : null}
            <span className={s.muted}>A linha liga as paradas, não é o caminho real.</span>
          </p>
        </section>

        <div className={s.timeline} data-testid="route-timeline">
          <LegLine leg={route.outbound} money={money} />
          {route.stops.map((st, i) => (
            <div key={st.name} className={s.stack}>
              {i > 0 ? <LegLine leg={route.legs[i - 1] ?? null} money={money} /> : null}
              <StopCard
                st={st} i={i} count={route.stops.length} dates={dates[i]} cost={costs[i]} money={money} places={ob.places} marks={marks}
                info={about(st.name).info} wishes={wishesAt(route, st)}
                onNights={(d) => edit(adjustNights(route, i, d))} onMove={(d) => edit(moveStop(route, i, i + d))} onRemove={() => void remove(i)}
                onOpen={() => openSheet({ type: 'stop', name: st.name })} onTrip={(name) => openSheet({ type: 'trip', stop: st.name, name }, st.name)}
              />
            </div>
          ))}
          <LegLine leg={route.return} money={money} />
        </div>

        {route.wishes.length ? (
          <section aria-labelledby="wishes" className={s.stack}>
            <h2 id="wishes" className={s.label}>Seus pedidos</h2>
            {route.wishes.map((w) => (
              <div key={w.wish} className={s.wishRowCard} data-fits={w.stop ? 'true' : 'false'}>
                <span className={s.wishIcon} aria-hidden="true"><Icon name={w.stop ? 'check' : 'alert'} size={16} /></span>
                <span className={s.wishText}>
                  <b>{w.wish}</b>
                  {w.stop
                    ? <small>Entrou em <b>{w.stop}</b>{w.how ? `: ${w.how}` : '.'}</small>
                    : <small><b>Não coube.</b> {w.reason}</small>}
                  {!w.stop && w.sacrifice ? <small><b>Pra caber:</b> {w.sacrifice}</small> : null}
                </span>
                {w.stop
                  ? <Button size="sm" variant="ghost" onClick={() => scrollToStop(w.stop!)}>Ver no roteiro</Button>
                  : canAsk ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => void fitWish(w)}>{w.sacrifice ? 'Trocar e encaixar' : 'Tentar encaixar'}</Button> : null}
              </div>
            ))}
          </section>
        ) : null}

        {route.left_out.length ? (
          <section aria-labelledby="left-out" className={s.stack}>
            <h2 id="left-out" className={s.label}>Ficou de fora</h2>
            {route.left_out.map((l) => (
              <div key={l.name} className={s.cut} data-left-out={l.name} data-focus={focus === outId(l.name) ? 'true' : undefined}>
                <span className={s.stack} style={{ gap: 4, minWidth: 0 }}>
                  <button type="button" className={s.linkBtn} onClick={() => openSheet({ type: 'out', name: l.name })}>{l.name} <Icon name="info" size={14} /></button>
                  <OriginBadge name={l.name} places={ob.places} marks={marks} />
                  <small className={s.muted}>{l.reason}</small>
                  {l.sacrifice ? <small className={s.sacrifice}><b>Pra caber:</b> {l.sacrifice}</small> : null}
                </span>
                <span className={s.cutActions}>
                  <Button size="sm" variant="ghost" onClick={() => showOnMap(outId(l.name), l.name)}><Icon name="pin" size={15} /> Ver no mapa</Button>
                  {canAsk ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => void fetchRoute({ force: [l.name] })}>Incluir</Button> : null}
                </span>
              </div>
            ))}
          </section>
        ) : null}

        <section className={s.feedback} aria-labelledby="ajuste">
          <h2 id="ajuste" className={s.label}><Icon name="sparkle" size={14} /> Pedir um ajuste à Trilha</h2>
          <textarea
            id="route-feedback" className={s.feedbackInput} rows={2} maxLength={300} value={feedback} disabled={!canAsk}
            placeholder='Ex.: "Roma ficou com muitos dias", "quero terminar em Milão"' onChange={(e) => setFeedback(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendFeedback(); } }}
            aria-label="Ajuste que você quer no roteiro"
          />
          <div className={s.chips}>{FEEDBACK_IDEAS.map((f) => <Chip key={f} size="sm" disabled={!canAsk} onClick={() => setFeedback(f)}>{f}</Chip>)}</div>
          <div className={s.actions}>
            <Button size="sm" disabled={!feedback.trim() || !canAsk} onClick={sendFeedback}>Refazer com esse ajuste</Button>
            <Button size="sm" variant="secondary" disabled={!canAsk} onClick={() => void fetchRoute({ variant: 'calmo' })}>Mais calmo</Button>
            <Button size="sm" variant="secondary" disabled={!canAsk} onClick={() => void fetchRoute({ variant: 'mais_lugares' })}>Mais lugares</Button>
            {skippedNearby.map((n) => <Button key={n.name} size="sm" variant="ghost" disabled={!canAsk} onClick={() => void fetchRoute({ force: [n.name] })}>Incluir {n.name}</Button>)}
          </div>
          <small className={s.muted}>{calls < MAX_ROUTE_CALLS ? `A Trilha refaz a rota a partir do que está na tela. Restam ${MAX_ROUTE_CALLS - calls} pedidos.` : `Você já pediu ${MAX_ROUTE_CALLS} rotas. Os ajustes de noites e ordem continuam valendo.`}</small>
        </section>

        {replace ? (
          <div className={s.note} role="alert">
            Já existe um roteiro nesta trilha. Substituir? Paradas, trechos e passeios atuais serão trocados por este.
            <div className={s.actions} style={{ marginTop: 8 }}><Button size="sm" onClick={() => apply(true)} disabled={busy}>Substituir</Button><Button size="sm" variant="secondary" onClick={() => setReplace(false)}>Cancelar</Button></div>
          </div>
        ) : null}
        {err ? <p className={s.note} role="alert">{err}</p> : null}
        <div className={s.actions}>
          <Button disabled={busy || !online} onClick={() => apply(false)}>{busy ? <Busy>Salvando</Busy> : 'Gostei, ver passeios'}</Button>
          {ob.step >= 5 && b.stops.length ? <Button variant="secondary" disabled={busy} onClick={() => go(5)}>Seguir sem mudar o roteiro salvo</Button> : null}
        </div>
      </ChatOptions>
      {sheetView}
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
  // `pick` = recomendações da Trilha (pelo ritmo e pelos gostos); a decisão é da pessoa, carta a carta.
  const [pick, setPick] = useState<Set<string>>(new Set(ob.tour_pick ?? []));
  const [decisions, setDecisions] = useState<Record<string, Decision>>(ob.tour_decisions ?? {});
  const [review, setReview] = useState(false);
  const started = useRef(false);
  const wishKeys = new Set((ob.wishes ?? []).map((w) => w.toLowerCase().trim()));

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
          // Só vale como "seu pedido" o que a pessoa escreveu no passo 3 (a IA às vezes marca tudo).
          tags: t.tags ?? [], day_fit: t.day_fit ?? null, photo_query: t.photo_query ?? null, wish: t.wish && wishKeys.has(t.wish.toLowerCase().trim()) ? t.wish : null,
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
  // O que entra: "quero" nas cartas; carta ainda não decidida segue a recomendação da Trilha.
  const chosenIds = new Set(all.filter((t) => (decisions[t.id] ? decisions[t.id] === 'yes' : pick.has(t.id))).map((t) => t.id));
  const picked = all.filter((t) => chosenIds.has(t.id));
  const total = picked.reduce((a, t) => a + Math.round((t.cost_low + t.cost_high) / 2), 0);
  const loadingAny = stops.some((st) => !tours[st.id]);
  const allFailed = !loadingAny && stops.every((st) => failed.has(st.id) && !(tours[st.id] ?? []).length);
  const finished = !loadingAny && all.every((t) => decisions[t.id]);
  const groups: DeckGroup[] = stops.map((st) => ({ stop: { id: st.id, name: st.name, nights: Math.max(0, daysBetween(st.arrival_date, st.departure_date)) }, ideas: tours[st.id] }));
  const acceptRest = () => {
    const next = { ...decisions };
    for (const t of all) if (!next[t.id]) next[t.id] = pick.has(t.id) ? 'yes' : 'no';
    setDecisions(next);
  };

  const next = (skip = false) => run(async () => {
    if (ob.tours_applied) { go(6); return; }
    const ids: string[] = [];
    if (!skip) {
      for (const st of stops) {
        const list = tours[st.id] ?? [];
        const chosen = list.filter((t) => chosenIds.has(t.id));
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
        for (const t of list.filter((x) => !chosenIds.has(x.id))) {
          await source.insert('suggestions', {
            trip_id: b.trip.id, stop_id: st.id, kind: 'activity', status: 'new', source: 'ai',
            payload: { title: t.title.slice(0, 80), why: t.why ?? null, duration: t.duration ?? null, day_fit: t.day_fit ?? null, cost_low: t.cost_low, cost_high: t.cost_high, currency: b.trip.base_currency, photo_query: t.photo_query ?? null },
          });
        }
      }
    }
    const plan: BudgetPlan = { ...(b.trip.budget_plan ?? { style: prefs.stay, pace: prefs.pace }), activities: skip ? undefined : ids };
    await persist({ ...ob, step: 6, tours, tour_pick: [...pick], tour_decisions: decisions, tours_applied: true }, { budget_plan: plan });
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
  const showSummary = finished || review;
  const summaryValue = Object.fromEntries(all.map((t) => [t.id, chosenIds.has(t.id) ? 'yes' : 'no'])) as Record<string, Decision>;
  return (
    <StepChat label="Passeios por cidade">
      <TrilhaBubble step="5 · Passeios">{showSummary ? <>Pronto! Esses são os passeios que entram. <b>Toque para trocar.</b></> : <>Um passeio por vez: <b>quero</b> ou <b>pular</b>?</>}</TrilhaBubble>
      <ChatOptions>
        {showSummary ? (
          <>
            <DeckSummary groups={groups} value={summaryValue} onChange={setDecisions} money={money} />
            {!finished ? <Button variant="ghost" onClick={() => setReview(false)}>Voltar para as cartas</Button> : null}
          </>
        ) : (
          <>
            <TourDeck groups={groups} value={decisions} onChange={setDecisions} recommended={pick} wishes={ob.wishes ?? []} money={money} onAcceptRest={acceptRest} />
            <Button variant="ghost" onClick={() => setReview(true)} disabled={loadingAny}>Ver a lista inteira</Button>
          </>
        )}
        <div className={s.foot} data-static={!showSummary}>
          <span><b>{picked.length} passeios</b> · ≈ {money(total)} por pessoa <EstimateBadge /></span>
          <Button disabled={busy || loadingAny} onClick={() => next(false)}>{busy ? <Busy>Salvando</Busy> : 'Ver quanto custa'}</Button>
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
          <Button disabled={busy || !online} onClick={() => finish(false)}>{busy ? <Busy>Salvando</Busy> : 'Concluir'}</Button>
          <Button variant="secondary" disabled={busy || !online} onClick={() => finish(true)}>Chamar a turma</Button>
        </div>
        {!online ? <p className={s.muted}>Precisa de internet para salvar.</p> : null}
        <p className={s.muted}>Mudou de ideia? Tudo isso fica no <Link href={`../roteiro`}>Roteiro</Link> e em Dinheiro, e dá pra editar quando quiser.</p>
      </ChatOptions>
      {inviting ? <InviteSheet onClose={() => { setInviting(false); onDone(); }} /> : null}
    </StepChat>
  );
}

