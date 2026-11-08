'use client';
// Início (planning §5.1, canvas Inicio.dc.html): hero com foto e contagem, "Hoje a Trilha sugere",
// cartão escuro do dinheiro da turma e o próximo passo do planejamento.
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { TripSwitcherButton } from '../components/shell/TripSwitcher';
import { AvatarStack } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { useAction } from '../components/ui/feedback';
import type { IconName } from '../components/ui/icons.data';
import { ListRow } from '../components/ui/ListRow';
import { Photo, type PhotoData } from '../components/ui/Photo';
import { Progress } from '../components/ui/Progress';
import { Sheet } from '../components/ui/Sheet';
import { SuggestionCard } from '../components/ui/SuggestionCard';
import { useAuth } from '../data/AuthContext';
import { acceptSuggestion, dismissSuggestion, voteSuggestions } from '../data/suggestionActions';
import { useBundle } from '../data/TripContext';
import type { Suggestion, TripBundle } from '../data/types';
import { useCover } from '../data/useCover';
import { callAi } from '../lib/ai/client';
import { sortedStops, tripPhase, tripTarget, type Phase } from '../lib/derive';
import { dateSpan } from '../lib/format';
import { budgetOverview, formatMoney } from '../lib/money';
import { fetchPhoto } from '../lib/photos';
import { hasDestination, nextStep, planStage } from '../lib/plan';
import { rankForHome, stopsNeedingSuggestions, type HomeCard, type HomeCardType } from '../lib/suggestions';
import { countdown, todayIn } from '../lib/time';
import PlanningHome from './PlanningHome';
import s from './inicio.module.css';

/** Trilha sem destino abre o Início do planejamento; com destino, a Início do canvas. */
export default function Inicio() {
  const { bundle } = useBundle();
  return hasDestination(bundle) ? <TripInicio /> : <PlanningHome />;
}

const VISIBLE = 3;
const ICON: Record<HomeCardType, { icon: IconName; tone: 'brand' | 'sun' | 'ok' | 'neutral' | 'dark'; eyebrow: 'brand' | 'warn' | 'ok' | 'mute' }> = {
  vote: { icon: 'check', tone: 'ok', eyebrow: 'warn' },
  reserve: { icon: 'bed', tone: 'brand', eyebrow: 'brand' },
  activity: { icon: 'sparkle', tone: 'brand', eyebrow: 'brand' },
  area: { icon: 'pin', tone: 'brand', eyebrow: 'brand' },
  document: { icon: 'doc', tone: 'sun', eyebrow: 'warn' },
  pool: { icon: 'wallet', tone: 'sun', eyebrow: 'warn' },
};

function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Pede sugestões novas à IA para a próxima parada sem sugestão (no máximo 1 vez por dia por trilha neste aparelho). */
function useAutoSuggest(b: TripBundle, enabled: boolean, reload: () => Promise<void>) {
  const { online } = useAuth();
  useEffect(() => {
    if (!enabled || !online) return;
    const stop = stopsNeedingSuggestions(b)[0];
    if (!stop) return;
    const key = `trilha.suggest.${b.trip.id}.${stop.id}`;
    const today = new Date().toISOString().slice(0, 10);
    try {
      if (sessionStorage.getItem(key) === today) return;
      sessionStorage.setItem(key, today);
    } catch {
      /* sem storage: segue (o servidor também limita a 1 por parada por dia) */
    }
    void callAi<unknown>('suggest', { tripId: b.trip.id, stopId: stop.id }).then((r) => {
      if (r && (r as unknown as { inserted?: number }).inserted) void reload();
    });
  }, [b, enabled, online, reload]);
}

/** Foto da sugestão grande: a gravada; senão busca na Wikimedia e grava (editor, conta real). */
function useSuggestionPhoto(s: Suggestion | undefined, canResolve: boolean, save: (s: Suggestion, photo: PhotoData) => void) {
  const [photo, setPhoto] = useState<PhotoData | null>(null);
  const stored = s?.payload.photo?.url ? (s.payload.photo as PhotoData) : null;
  const q = s?.payload.photo_query ?? null;
  useEffect(() => {
    setPhoto(null);
    if (!s || stored || !q || !canResolve) return;
    let alive = true;
    void fetchPhoto(q).then((p) => {
      if (!alive || !p?.url) return;
      setPhoto(p as PhotoData);
      save(s, p as PhotoData);
    });
    return () => {
      alive = false;
    };
  }, [s?.id, q, canResolve]); // eslint-disable-line react-hooks/exhaustive-deps
  return stored ?? photo;
}

function TripInicio() {
  const { bundle: b, base, me, canEdit, source, reload } = useBundle();
  const { run, busy } = useAction();
  const now = useNow();
  const trip = b.trip;
  const stops = useMemo(() => sortedStops(b), [b]);
  const first = stops[0];
  const phase = tripPhase(trip, now);
  const cover = useCover();
  const demo = source.kind === 'demo';
  const [all, setAll] = useState(false);

  useAutoSuggest(b, canEdit && !demo, reload);

  const cards = useMemo(() => rankForHome(b, me, now), [b, me, now]);
  const visible = cards.slice(0, VISIBLE);
  // O cartão grande com foto vai primeiro (canvas); os demais seguem a ordem de prioridade.
  const big = visible.find((c) => c.suggestion);
  const rows = visible.filter((c) => c !== big);

  const savePhoto = (sg: Suggestion, photo: PhotoData) => {
    void source.update('suggestions', sg.id, { payload: { ...sg.payload, photo } }, sg.version).then(() => reload()).catch(() => undefined);
  };
  const bigPhoto = useSuggestionPhoto(big?.suggestion, canEdit && !demo, savePhoto);

  // Foto do hero: capa da turma → foto da primeira parada → placeholder na cor da trilha.
  const heroPhoto: PhotoData | null = cover ? { url: cover } : first?.photo?.url ? (first.photo as PhotoData) : null;
  const heroPlace = cover ? undefined : first?.name;

  const accept = (c: HomeCard) =>
    run(async () => {
      await acceptSuggestion(source, b, c.suggestion!, c.slot?.date ?? null);
      await reload();
    }, { success: c.slot ? `${c.title} entrou no dia ${c.slot.dayNumber}.` : `${c.title} escolhido.` });
  const vote = (c: HomeCard) =>
    run(async () => {
      await voteSuggestions(source, b, [c.suggestion!], me);
      await reload();
    }, { success: 'Votação criada. A turma vota em Turma › Votos.' });
  const dismiss = (c: HomeCard) =>
    run(async () => {
      await dismissSuggestion(source, c.suggestion!);
      await reload();
    }, { success: 'Sugestão dispensada.' });

  const people = b.members.map((m) => {
    const p = b.profiles.find((x) => x.id === m.user_id);
    return { id: m.user_id, name: p?.display_name ?? 'Pessoa', color: p?.color, me: m.user_id === me };
  });

  const money = budgetOverview(b);
  const cur = trip.base_currency;
  const step = planStage(b, now) !== 'viajar' ? nextStep(b, me, now) : null;
  const today = todayIn(trip.departure_tz || 'America/Sao_Paulo', now);
  const todayStop = phase.kind === 'during' || phase.kind === 'today'
    ? stops.find((x) => today >= x.arrival_date && today <= x.departure_date) ?? null
    : null;
  const todayActs = todayStop ? b.activities.filter((a) => a.stop_id === todayStop.id && a.day === today).sort((x, y) => (x.time ?? '99').localeCompare(y.time ?? '99') || x.position - y.position) : [];

  return (
    <div className={s.page}>
      <section className={s.hero} aria-label="Contagem da viagem">
        <Photo photo={heroPhoto} place={heroPlace} height="100%" radius="0" overlay priority caption={false} className={s.heroPhoto}>
          <div className={s.heroTop}>
            <TripSwitcherButton variant="photo" />
            <Link href={`${base}/turma`} className={s.turma} aria-label="Abrir a turma">
              <AvatarStack people={people} max={3} size={32} />
            </Link>
          </div>
          <div className={s.heroBase}>
            <span className={s.heroLine}>{trip.title} · {dateSpan(trip.start_date, trip.end_date)}</span>
            <HeroCount phase={phase} now={now} target={tripTarget(trip)} tz={trip.departure_tz || 'America/Sao_Paulo'} firstName={first?.name ?? trip.title} todayName={todayStop?.name ?? null} base={base} />
            {heroPhoto && heroPlace ? <span className={s.heroCaption}>foto · {heroPlace}</span> : null}
          </div>
        </Photo>
      </section>

      <div className={s.body}>
        <div className={s.main}>
          {todayStop ? (
            <section className={s.section} aria-labelledby="hoje">
              <div className={s.sectionHead}>
                <h2 id="hoje" className={s.h2}>Hoje em {todayStop.name}</h2>
                <Link href={`${base}/roteiro/${todayStop.id}`} className={s.more}>Abrir parada</Link>
              </div>
              {todayActs.length ? (
                <div className={s.list}>
                  {todayActs.map((a) => (
                    <ListRow key={a.id} card icon="cal" iconTone="neutral" eyebrow={a.time ? a.time.slice(0, 5) : 'Hoje'} eyebrowTone="mute" title={a.title} subtitle={a.notes ?? undefined} />
                  ))}
                </div>
              ) : (
                <EmptyState compact icon="cal" title="Dia livre" text="Nada marcado pra hoje. Bom dia pra descansar ou ver as sugestões." />
              )}
            </section>
          ) : null}

          <section className={s.section} aria-labelledby="sugere">
            <div className={s.sectionHead}>
              <h2 id="sugere" className={s.h2}>Hoje a Trilha sugere</h2>
              {cards.length > VISIBLE ? (
                <button type="button" className={s.more} onClick={() => setAll(true)}>
                  <span className="num">{`${VISIBLE} de ${cards.length} · ver todas`}</span>
                </button>
              ) : cards.length ? <span className={s.count}><span className="num">{cards.length}</span> {cards.length === 1 ? 'item' : 'itens'}</span> : null}
            </div>

            {!cards.length ? (
              <EmptyState compact icon="check" title="Tudo em dia" text="Sem votos, reservas ou pendências agora. Quando surgir algo, aparece aqui." />
            ) : (
              <div className={s.list}>
                {big?.suggestion ? (
                  <SuggestionCard
                    reason={big.eyebrow}
                    title={big.title}
                    text={<SuggestionText c={big} />}
                    photo={bigPhoto}
                    place={big.suggestion.payload.photo_query ?? big.title}
                    by="ai"
                    busy={busy}
                    acceptLabel={big.type === 'activity' && big.slot ? `Pôr no dia ${big.slot.dayNumber}` : 'Escolher'}
                    onAccept={canEdit ? () => void accept(big) : undefined}
                    onVote={canEdit ? () => void vote(big) : undefined}
                    onDismiss={canEdit ? () => void dismiss(big) : undefined}
                  />
                ) : null}
                {rows.map((c) => <CardRow key={c.key} c={c} base={base} />)}
              </div>
            )}
          </section>
        </div>

        <aside className={s.side}>
          <section className={s.money} aria-labelledby="dinheiro">
            <div className={s.moneyHead}>
              <h2 id="dinheiro" className={s.moneyLabel}>Dinheiro da turma</h2>
              {money.plannedCents > 0 ? <Link href={`${base}/dinheiro`} className={s.moneyLink}>Abrir</Link> : null}
            </div>
            {money.plannedCents > 0 ? (
              <>
                <div className={s.moneyRow}>
                  <div className={s.moneyVals}>
                    <span className={`${s.moneyBig} num`}>{formatMoney(money.pooledCents, cur, { compact: true })}</span>
                    <span className={s.moneySub}>juntados, de {formatMoney(money.plannedCents, cur, { compact: true })} planejados</span>
                  </div>
                  <span className={`${s.moneyPct} num`}>{money.pooledPct ?? 0}%</span>
                </div>
                <Progress value={Math.min(100, money.pooledPct ?? 0)} color="var(--sun)" track="var(--dark-2)" label={`${money.pooledPct ?? 0}% do planejado já está no caixa`} />
              </>
            ) : (
              <>
                <p className={s.moneySub}>Ainda sem orçamento. Responda umas perguntas e a Trilha monta o previsto a partir do roteiro.</p>
                <Button href={`${base}/dinheiro/orcamento`} variant="primary" iconEnd="arrow">Montar orçamento</Button>
              </>
            )}
          </section>

          {step ? (
            <Link href={base + step.link} className={s.step}>
              <span className={s.stepEyebrow}>Próximo passo</span>
              <span className={s.stepTitle}>{step.title.replace(/\.$/, '')}</span>
              <span className={s.stepDetail}>{step.detail}</span>
            </Link>
          ) : null}
        </aside>
      </div>

      <Sheet open={all} onClose={() => setAll(false)} title="Tudo que a Trilha sugere" description={`${cards.length} itens, do mais urgente ao menos urgente.`} size="lg">
        <div className={s.list}>
          {cards.map((c) => <CardRow key={c.key} c={c} base={base} />)}
        </div>
      </Sheet>
    </div>
  );
}

function SuggestionText({ c }: { c: HomeCard }) {
  const p = c.suggestion!.payload;
  const bits = [p.duration, p.cost_high != null ? (p.cost_high > 0 ? `≈ ${formatMoney(Math.round(((p.cost_low ?? p.cost_high) + p.cost_high) / 2), p.currency ?? 'BRL', { compact: true })}/pessoa` : 'grátis') : null].filter(Boolean);
  return (
    <>
      {c.detail}
      {bits.length ? <span className={s.meta}> {bits.join(' · ')}{p.cost_high ? <span className={s.est}> ESTIMATIVA</span> : null}</span> : null}
    </>
  );
}

function CardRow({ c, base }: { c: HomeCard; base: string }) {
  const t = ICON[c.type];
  return (
    <ListRow card icon={t.icon} iconTone={t.tone} eyebrow={c.eyebrow} eyebrowTone={t.eyebrow} title={c.title} subtitle={c.detail || undefined} href={base + c.href} chevron />
  );
}

/** Número gigante do hero e suas variações (antes, menos de 2 dias, é hoje, durante, depois). */
function HeroCount({ phase, now, target, tz, firstName, todayName, base }: { phase: Phase; now: number; target: number; tz: string; firstName: string; todayName: string | null; base: string }) {
  if (phase.kind === 'after') {
    return (
      <div className={s.count2}>
        <span className={s.big}>Como foi?</span>
        <Link href={`${base}/turma/diario`} className={s.heroCta}>Abrir o Diário</Link>
      </div>
    );
  }
  if (phase.kind === 'during') {
    return (
      <div className={s.count2} aria-label={`Dia ${phase.day} de ${phase.total}${todayName ? `, em ${todayName}` : ''}`}>
        <span className={`${s.big} num`}>{phase.day}</span>
        <span className={s.unit}>dia de {phase.total}{todayName ? <><br />{todayName}</> : null}</span>
      </div>
    );
  }
  if (phase.kind === 'today' || now >= target) {
    return <div className={s.count2}><span className={s.big}>É hoje.</span></div>;
  }
  const cd = countdown(now, target, tz);
  const hours = Math.floor((target - now) / 3_600_000);
  if (hours < 48) {
    const min = Math.floor(((target - now) % 3_600_000) / 60_000);
    return (
      <div className={s.count2} aria-label={`${hours} horas e ${min} minutos para ${firstName}`}>
        <span className={`${s.big} num`}>{hours}h{String(min).padStart(2, '0')}</span>
        <span className={s.unit}>para<br />{firstName}</span>
      </div>
    );
  }
  return (
    <div className={s.count2} aria-label={`${cd.totalDays} dias para ${firstName}`}>
      <span className={`${s.big} num`}>{cd.totalDays}</span>
      <span className={s.unit}>dias para<br />{firstName}</span>
    </div>
  );
}
