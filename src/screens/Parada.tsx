'use client';
// Página da parada (canvas "cidade e reservas", artboard 1): capa com uma frase que situa, o que falta (chegar,
// dormir, dias), os dias de relance, o que fazer (passeios com contexto), onde dormir e o resto em cartões.
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { EditStopSheet, StayOptionSheet, StaySheet } from '../components/route/RouteSheets';
import { TicketSheet } from '../components/route/Ticket';
import { TourCard, TourDetail } from '../components/route/Tour';
import { Chip } from '../components/ui/Chip';
import { Badge, EstimateBadge } from '../components/ui/Badge';
import { Button, IconButton } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { useAction, useToast } from '../components/ui/feedback';
import { Field } from '../components/ui/Field';
import { formatMoneyTyping, parseMoneyInput } from '../components/ui/MoneyInput';
import { Photo, type PhotoData } from '../components/ui/Photo';
import { AiNote, Icon } from '../components/ui/primitives';
import { AiBusy } from '../components/ui/Loader';
import { Sheet } from '../components/ui/Sheet';
import { useAuth } from '../data/AuthContext';
import { acceptSuggestion, voteSuggestions } from '../data/suggestionActions';
import { useBundle } from '../data/TripContext';
import { parseOnboarding, placeKey } from '../lib/onboarding';
import type { Stop, Suggestion, TripBundle } from '../data/types';
import { useResolvedPhoto } from '../data/usePhoto';
import { callAi } from '../lib/ai/client';
import { currencyForCountry, currencyLabel } from '../lib/currency';
import { docsOfStop, sortedStops, stayOf, stopNights } from '../lib/derive';
import { headcount, nightlyCap, rangeLabel, staySearchLinks } from '../lib/explore';
import { dateSpan, dayMonth, hhmm } from '../lib/format';
import { formatMoney } from '../lib/money';
import { inspirationScore } from '../lib/polls';
import { legInto, stopAreas, stopIntro, stopReadiness, stopTours, type AreaItem, type ReadyItem, type Tour } from '../lib/route';
import { stopSlots } from '../lib/suggestions';
import { ruleTip } from '../lib/rules';
import { daysBetween, weekday } from '../lib/time';
import s from './parada.module.css';

const MONTH_NAME = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

type Open =
  | { kind: 'edit' } | { kind: 'stay' } | { kind: 'transport' } | { kind: 'filters' }
  | { kind: 'area'; item: AreaItem } | { kind: 'tour'; key: string } | { kind: 'option'; link: string }
  | null;

export default function Parada() {
  const { stopId } = useParams<{ stopId: string }>();
  const { bundle: b, base } = useBundle();
  const stops = useMemo(() => sortedStops(b), [b]);
  const i = stops.findIndex((x) => x.id === stopId);
  if (i < 0) {
    return (
      <div className={s.missing}>
        <EmptyState icon="pin" title="Parada não encontrada" text="Ela pode ter sido excluída ou o link está errado." action={<Button href={`${base}/roteiro`} icon="back">Voltar ao roteiro</Button>} />
      </div>
    );
  }
  return <StopPage key={stops[i].id} stop={stops[i]} index={i} stops={stops} />;
}

function StopPage({ stop, index, stops }: { stop: Stop; index: number; stops: Stop[] }) {
  const { bundle: b, base, canEdit, source, reload, me } = useBundle();
  const router = useRouter();
  const toast = useToast();
  const { run, busy } = useAction();
  const demo = source.kind === 'demo';
  const resolve = canEdit && !demo;
  const [open, setOpen] = useState<Open>(null);
  const nights = Math.max(0, daysBetween(stop.arrival_date, stop.departure_date));

  // Capa: foto gravada; senão a da Wikimedia, gravada na parada para a turma toda (e para o offline).
  const cover = useResolvedPhoto(stop.photo, [stop.name, stop.country].filter(Boolean).join(', '), resolve, (photo) => {
    void source.update('stops', stop.id, { photo }, stop.version).then(reload).catch(() => undefined);
  });

  const { chosen, others } = useMemo(() => stopAreas(b, stop), [b, stop]);
  const tours = useMemo(() => stopTours(b, stop), [b, stop]);
  const ready = useMemo(() => stopReadiness(b, stops, index, (c, cur) => formatMoney(c, cur, { compact: true })), [b, stops, index]);
  const intro = useMemo(() => stopIntro(b, stops, index), [b, stops, index]);
  const stay = stayOf(b, stop.id);
  const arrival = b.transports.find((t) => t.stop_id === stop.id && !t.is_return) ?? null;
  const tip = stop.tip ?? (ruleTip(b, stop) ? { ...ruleTip(b, stop)!, by: 'rules' as const, source: undefined } : null);
  const newAreas = others.map((a) => a.suggestion).filter((x): x is Suggestion => !!x && x.status === 'new');
  const [asking, setAsking] = useState(false);
  const filters = useFilters(b);

  const askSuggestions = async () => {
    setAsking(true);
    const r = await callAi<unknown>('suggest', { tripId: b.trip.id, stopId: stop.id });
    setAsking(false);
    const res = r as unknown as { inserted?: number; reason?: string } | null;
    if (res?.inserted) await reload();
    else toast(res?.reason === 'today' ? 'Já pedimos sugestões para esta parada hoje. Amanhã dá pra pedir de novo.' : 'A IA não respondeu agora. O resto funciona normal.');
  };
  const chooseArea = (it: AreaItem) =>
    run(async () => {
      if (it.suggestion) await acceptSuggestion(source, b, it.suggestion);
      else await source.update('stops', stop.id, { area: it.title.slice(0, 80) }, stop.version);
      await reload();
      setOpen(null);
    }, { success: `Fiquem em ${it.title}. A busca de hospedagem já usa o bairro.` });
  const voteAreas = () =>
    run(async () => {
      await voteSuggestions(source, b, newAreas, me);
      await reload();
      setOpen(null);
    }, { success: 'Votação de bairros criada. A turma vota em Turma › Votos.' });
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const onReady = (it: ReadyItem) => {
    if (it.key === 'arrive') setOpen({ kind: 'transport' });
    else if (it.key === 'stay') {
      if (it.state === 'wait') router.push(`${base}/turma/votos`);
      else if (it.state === 'done' && canEdit) setOpen({ kind: 'stay' });
      else jump('onde');
    } else jump(it.state === 'done' ? 'dias' : 'passeios');
  };
  const sugBtn = (label: string) => (
    <Button size="sm" variant="secondary" icon={asking ? undefined : 'sparkle'} onClick={() => void askSuggestions()} disabled={asking}>
      {asking ? <AiBusy steps={['Pedindo', 'Pensando', 'Montando']} /> : label}
    </Button>
  );
  const openTour = open?.kind === 'tour' ? tours.find((t) => t.key === open.key) ?? null : null;

  return (
    <div className={s.page}>
      <nav className={s.strip} aria-label="Paradas da viagem">
        {stops.map((x, i) => (
          x.id === stop.id
            ? <span key={x.id} className={`${s.stripItem} ${s.stripOn}`} aria-current="page">{i + 1} {x.name}</span>
            : <Link key={x.id} href={`${base}/roteiro/${x.id}`} className={s.stripItem}>{i + 1} {x.name}</Link>
        ))}
      </nav>

      <section className={s.cover} aria-label={`Capa de ${stop.name}`}>
        <Photo photo={cover as PhotoData | null} place={stop.name} height="100%" radius="0" overlay priority className={s.coverPhoto}>
          <div className={s.coverTop}>
            <Link href={`${base}/roteiro`} className={s.back} aria-label="Voltar ao roteiro"><Icon name="back" size={22} /></Link>
            {canEdit ? <IconButton icon="edit" label="Editar parada" variant="light" onClick={() => setOpen({ kind: 'edit' })} /> : null}
          </div>
          <div className={s.coverBase}>
            <span className={s.coverLine}>Parada {index + 1} de {stops.length} · {dateSpan(stop.arrival_date, stop.departure_date)} · {stopNights(stop)}</span>
            <h1 className={s.coverName}>{stop.name}</h1>
            <p className={s.coverIntro}>{intro}</p>
          </div>
        </Photo>
      </section>

      <div className={s.body}>
        {ready.length ? <Readiness items={ready} stopName={stop.name} onAction={onReady} /> : null}
        {tip ? <AiNote by={tip.by} source={'source' in tip && tip.source ? tip.source : null}>{tip.text}</AiNote> : null}

        <DaysGlance b={b} stop={stop} base={base} />

        <section id="passeios" className={s.section} aria-labelledby="passeios-h">
          <div className={s.head}>
            <h2 id="passeios-h" className={s.h2}>O que fazer em {stop.name}</h2>
            {tours.length ? <p className={s.lead}>Toque num passeio para saber o que é e por que vale.</p> : null}
          </div>
          {tours.length ? (
            <ToursGrid tours={tours} stop={stop} resolve={resolve} onOpen={(t) => setOpen({ kind: 'tour', key: t.key })} />
          ) : (
            <EmptyState compact icon="sparkle" title="Nenhum passeio ainda" text={resolve ? 'A Trilha sugere passeios que cabem nos dias livres e no teto da turma, com o que é cada um.' : 'Quando a turma ou a Trilha sugerirem passeios, aparecem aqui.'}
              action={resolve ? sugBtn('Sugerir passeios') : undefined} />
          )}
          {tours.length ? (
            <div className={s.toursFoot}>
              {resolve ? <Button size="sm" variant="ghost" icon={asking ? undefined : 'sparkle'} onClick={() => void askSuggestions()} disabled={asking}>{asking ? <AiBusy steps={['Pedindo', 'Pensando', 'Montando']} /> : 'Pedir mais ideias'}</Button> : null}
              {tours.some((t) => t.estimate) ? <p className={s.honest}>Preços com ≈ são estimativas da Trilha, não preço ao vivo. Confira antes de reservar.</p> : null}
            </div>
          ) : null}
        </section>

        {nights > 0 ? (
          <section id="onde" className={s.section} aria-labelledby="onde-h">
            <div className={s.head}>
              <h2 id="onde-h" className={s.h2}>Onde vocês dormem</h2>
              {!chosen && !stop.stay_base?.name ? <p className={s.lead}>Escolham o bairro antes do hotel.</p> : null}
            </div>
            <div className={s.stayGrid}>
              <div className={s.areas}>
                {chosen ? <ChosenArea item={chosen} resolve={resolve} onOpen={() => setOpen({ kind: 'area', item: chosen })} /> : null}
                {others.length ? (
                  <div className={s.areaGrid}>
                    {others.map((a) => <AreaTile key={a.key} item={a} onOpen={() => setOpen({ kind: 'area', item: a })} />)}
                  </div>
                ) : null}
                {!chosen && !others.length ? (
                  <EmptyState compact icon="pin" title="Sem bairro ainda" text={resolve ? 'A Trilha sugere bairros com prós e contras. Ou escolha um em Editar parada.' : 'Quem organiza escolhe o bairro. A busca de hospedagem usa a cidade enquanto isso.'}
                    action={resolve ? sugBtn('Sugerir bairros') : undefined} />
                ) : null}
              </div>
              <StayCard b={b} stop={stop} area={chosen?.title ?? null} canEdit={canEdit} onEditStay={() => setOpen({ kind: 'stay' })} onFilters={() => setOpen({ kind: 'filters' })} onPaste={(link) => setOpen({ kind: 'option', link })} filters={filters} />
            </div>
          </section>
        ) : null}

        <MoreAbout b={b} stop={stop} stops={stops} index={index} canEdit={canEdit} onTransport={() => setOpen({ kind: 'transport' })} />
      </div>

      {open?.kind === 'edit' ? <EditStopSheet stop={stop} onClose={() => setOpen(null)} onDeleted={() => router.replace(`${base}/roteiro`)} /> : null}
      {open?.kind === 'stay' ? <StaySheet stop={stop} stay={stay} onClose={() => setOpen(null)} /> : null}
      {open?.kind === 'transport' ? <TicketSheet stop={stop} t={arrival} onClose={() => setOpen(null)} /> : null}
      {openTour ? <TourDetail t={openTour} stop={stop} onClose={() => setOpen(null)} /> : null}
      {open?.kind === 'option' ? <StayOptionSheet stop={stop} link={open.link} onClose={() => setOpen(null)} /> : null}
      {open?.kind === 'filters' ? <FiltersSheet b={b} f={filters} onClose={() => setOpen(null)} /> : null}
      {open?.kind === 'area' ? (
        <AreaSheet item={open.item} stop={stop} resolve={resolve} canEdit={canEdit} busy={busy} canVote={newAreas.length >= 2}
          onChoose={() => void chooseArea(open.item)} onVote={() => void voteAreas()} onClose={() => setOpen(null)} />
      ) : null}
    </div>
  );
}

// ───────────── O que falta ─────────────

const READY_ICON: Record<ReadyItem['key'], 'plane' | 'bed' | 'cal'> = { arrive: 'plane', stay: 'bed', days: 'cal' };

function Readiness({ items, stopName, onAction }: { items: ReadyItem[]; stopName: string; onAction: (it: ReadyItem) => void }) {
  const todo = items.filter((x) => x.state !== 'done').length;
  const done = items.length - todo;
  return (
    <section className={s.section} aria-labelledby="falta">
      <div className={s.headRow}>
        <h2 id="falta" className={s.h2}>{todo ? `Para ${stopName} ficar pronta` : `${stopName} está pronta`}</h2>
        <span className={s.count}>{todo ? `${todo === 1 ? 'falta 1 coisa' : `faltam ${todo} coisas`}${done ? ` · ${done} ${done === 1 ? 'resolvida' : 'resolvidas'}` : ''}` : 'tudo certo'}</span>
      </div>
      <div className={s.ready}>
        {items.map((it) => (
          <article key={it.key} className={`${s.readyCard} ${s[`r_${it.state}`]}`}>
            <div className={s.readyTop}>
              <span className={s.readyIcon} aria-hidden="true"><Icon name={it.state === 'done' ? 'check' : READY_ICON[it.key]} size={18} /></span>
              <span className={s.readyLabel}>{it.label}</span>
            </div>
            <h3 className={s.readyTitle}>{it.title}</h3>
            <p className={s.readyText}>{it.text}</p>
            <button type="button" className={it.state === 'todo' && it.key === 'arrive' ? s.readyMain : s.readyBtn} onClick={() => onAction(it)}>{it.action}</button>
          </article>
        ))}
      </div>
    </section>
  );
}

// ───────────── Os dias, de relance ─────────────

const SLOT_MOOD: Record<string, string> = { vazio: 'livre', folga: 'com folga', cheio: 'cheio', aclimatar: 'aclimatar', viagem: 'dia de viagem' };
const WEEK = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function DaysGlance({ b, stop, base }: { b: TripBundle; stop: Stop; base: string }) {
  const slots = stopSlots(b, stop);
  if (slots.length < 2) return null;
  return (
    <section id="dias" className={s.section} aria-labelledby="dias-h">
      <div className={s.headRow}>
        <h2 id="dias-h" className={s.h2}>Os dias em {stop.name}</h2>
        <Link href={`${base}/roteiro`} className={s.inlineLink}>Abrir no roteiro</Link>
      </div>
      <div className={s.daysRow}>
        {slots.map((x) => {
          const acts = b.activities.filter((a) => a.stop_id === stop.id && a.day === x.date).sort((p, q) => (p.time ?? '99').localeCompare(q.time ?? '99') || p.position - q.position);
          return (
            <div key={x.date} className={s.dayCard}>
              <span className={s.dayLabel}>Dia {x.dayNumber} · {WEEK[weekday(x.date)]}</span>
              {acts.length ? acts.slice(0, 2).map((a) => <span key={a.id} className={s.dayAct}>{a.title}</span>) : <span className={s.dayEmpty}>{x.state === 'viagem' ? 'Dia de viagem' : x.state === 'aclimatar' ? 'Chegar e aclimatar' : 'Ainda sem plano'}</span>}
              {acts.length > 2 ? <span className={s.dayMore}>+{acts.length - 2}</span> : null}
              <span className={s.dayMood}>{SLOT_MOOD[x.state]}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ───────────── Passeios ─────────────

type TourFilter = 'todos' | 'classico' | 'achadinho' | 'combina' | 'solto';

function ToursGrid({ tours, stop, resolve, onOpen }: { tours: Tour[]; stop: Stop; resolve: boolean; onOpen: (t: Tour) => void }) {
  const [f, setF] = useState<TourFilter>('todos');
  const opts: { id: TourFilter; label: string; n: number }[] = [
    { id: 'todos', label: 'Todos', n: tours.length },
    { id: 'classico', label: 'Clássicos', n: tours.filter((t) => t.tag === 'classico').length },
    { id: 'achadinho', label: 'Achadinhos', n: tours.filter((t) => t.tag === 'achadinho').length },
    { id: 'combina', label: 'Combinam com vocês', n: tours.filter((t) => t.tag === 'combina').length },
    { id: 'solto', label: 'Sem dia ainda', n: tours.filter((t) => t.status.kind === 'nova').length },
  ];
  const visible = opts.filter((o) => o.id === 'todos' || o.n > 0);
  const shown = tours.filter((t) => f === 'todos' || (f === 'solto' ? t.status.kind === 'nova' : t.tag === f));
  return (
    <>
      {visible.length > 2 ? (
        <div className={s.filters} role="group" aria-label="Filtrar passeios">
          {visible.map((o) => <Chip key={o.id} size="sm" selected={f === o.id} onClick={() => setF(o.id)} count={o.id === 'todos' ? undefined : o.n}>{o.label}</Chip>)}
        </div>
      ) : null}
      <div className={s.tours}>
        {(shown.length ? shown : tours).map((t) => <TourCard key={t.key} t={t} stop={stop} resolve={resolve} onOpen={() => onOpen(t)} />)}
      </div>
    </>
  );
}

// ───────────── Onde ficar ─────────────

function areaPrice(it: AreaItem): string | null {
  if (it.costLow == null || it.costHigh == null || it.costHigh <= 0) return null;
  return `${rangeLabel(it.costLow, it.costHigh, it.currency)} / noite`;
}

function ChosenArea({ item, resolve, onOpen }: { item: AreaItem; resolve: boolean; onOpen: () => void }) {
  const { source, reload } = useBundle();
  const photo = useResolvedPhoto(item.photo, item.photoQuery, resolve && !!item.suggestion, (p) => {
    const sg = item.suggestion;
    if (sg) void source.update('suggestions', sg.id, { payload: { ...sg.payload, photo: p } }, sg.version).then(reload).catch(() => undefined);
  });
  return (
    <article className={s.chosen} aria-label={`Bairro escolhido: ${item.title}`}>
      <button type="button" className={s.chosenBtn} onClick={onOpen} aria-label={`${item.title}: detalhes do bairro`}>
        <Photo photo={photo as PhotoData | null} place={item.title} height={190} radius="0">
          <span className={s.here}>Fiquem aqui</span>
        </Photo>
      </button>
      <div className={s.chosenBody}>
        <div className={s.chosenHead}>
          <h3 className={s.h3}>{item.title}</h3>
          {item.walk ? <span className={s.walk}>{item.walk}</span> : null}
        </div>
        {item.why ? <p className={s.text}>{item.why}</p> : null}
        {item.good || item.watch ? (
          <div className={s.pros}>
            {item.good ? <div className={s.good}><strong>Bom</strong><br />{item.good}</div> : null}
            {item.watch ? <div className={s.watch}><strong>Atenção</strong><br />{item.watch}</div> : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function AreaTile({ item, onOpen }: { item: AreaItem; onOpen: () => void }) {
  return (
    <button type="button" className={s.tile} onClick={onOpen}>
      <Photo photo={item.photo as PhotoData | null} place={item.title} height={100} radius="0" />
      <span className={s.tileText}>
        <b>{item.title}</b>
        <span>{item.watch ? `${item.good ? `${item.good}; ` : ''}${item.watch}` : item.why ?? ''}</span>
      </span>
    </button>
  );
}

function AreaSheet({ item, stop, resolve, canEdit, busy, canVote, onChoose, onVote, onClose }: { item: AreaItem; stop: Stop; resolve: boolean; canEdit: boolean; busy: boolean; canVote: boolean; onChoose: () => void; onVote: () => void; onClose: () => void }) {
  const { source, reload } = useBundle();
  const photo = useResolvedPhoto(item.photo, item.photoQuery, resolve && !!item.suggestion, (p) => {
    const sg = item.suggestion;
    if (sg) void source.update('suggestions', sg.id, { payload: { ...sg.payload, photo: p } }, sg.version).then(reload).catch(() => undefined);
  });
  const price = areaPrice(item);
  return (
    <Sheet
      open onClose={onClose} variant="panel" title={item.title} description={item.chosen ? `Bairro escolhido em ${stop.name}` : `Bairro em ${stop.name}`}
      hero={<Photo photo={photo as PhotoData | null} place={item.title} height={220} radius="0" />}
      footer={canEdit ? (
        <>
          {canVote && !item.chosen ? <Button variant="secondary" onClick={onVote} disabled={busy}>Mandar bairros para votação</Button> : null}
          {!item.chosen ? <Button onClick={onChoose} disabled={busy}>Escolher este bairro</Button> : <Button variant="secondary" onClick={onClose}>Fechar</Button>}
        </>
      ) : undefined}
    >
      <div className={s.sheetBody}>
        {item.why ? <p className={s.text}>{item.why}</p> : null}
        {item.good || item.watch ? (
          <div className={s.pros}>
            {item.good ? <div className={s.good}><strong>Bom</strong><br />{item.good}</div> : null}
            {item.watch ? <div className={s.watch}><strong>Atenção</strong><br />{item.watch}</div> : null}
          </div>
        ) : null}
        {price ? <p className={s.inlineRow}><b className="num">{price}</b> para a turma <EstimateBadge /></p> : null}
        {item.suggestion?.source === 'ai' ? <p className={s.note}>Sugestão da Trilha a partir de conhecimento geral. Confira no mapa e nos comentários de quem ficou lá.</p> : null}
      </div>
    </Sheet>
  );
}

// ───────────── Hospedagem ─────────────

interface Filters { adults: number; capCents: number | null; set: (f: { adults?: number; capCents?: number | null }) => void }
let filterMemo: Record<string, { adults: number; capCents: number | null }> = {};

/** Filtros da busca (pessoas e teto por noite). Começa no tamanho da turma e no teto do orçamento; vale nesta sessão. */
function useFilters(b: TripBundle): Filters {
  const init = filterMemo[b.trip.id] ?? { adults: headcount(b), capCents: nightlyCap(b) || null };
  const [f, setF] = useState(init);
  return {
    ...f,
    set: (patch) => setF((cur) => {
      const next = { ...cur, ...patch };
      filterMemo = { ...filterMemo, [b.trip.id]: next };
      return next;
    }),
  };
}

function StayCard({ b, stop, area, canEdit, onEditStay, onFilters, onPaste, filters }: { b: TripBundle; stop: Stop; area: string | null; canEdit: boolean; onEditStay: () => void; onFilters: () => void; onPaste: (link: string) => void; filters: Filters }) {
  const { base } = useBundle();
  const stay = stayOf(b, stop.id);
  const cur = b.trip.base_currency;
  const [link, setLink] = useState('');
  const linkOk = /^https?:\/\/\S+$/i.test(link.trim());
  // Dormindo numa cidade vizinha mais barata (escolhido no Montar a viagem): a busca vai para lá, sem o bairro da cidade.
  const sleep = stop.stay_base?.name ? stop.stay_base : null;
  const place = sleep ? [sleep.name, sleep.country ?? stop.country].filter(Boolean).join(', ') : [stop.name, stop.country].filter(Boolean).join(', ');
  const where = sleep ? null : area;
  // O filtro do Booking/Airbnb usa o teto global; os chips leem o mesmo estado (vale para todas as paradas na sessão).
  const links = staySearchLinks(place, stop.arrival_date, stop.departure_date, filters.adults, { area: where, maxNightCents: filters.capCents, currency: cur });
  const { source, reload } = useBundle();
  const [undoing, setUndoing] = useState(false);
  const sleepHere = async () => {
    setUndoing(true);
    try {
      await source.update('stops', stop.id, { stay_base: null }, stop.version);
      // A diária estimada no Orçamento volta a ser a da própria cidade (a rota sugerida guarda as duas).
      const plan = b.trip.budget_plan;
      if (plan?.stay_estimates?.[stop.id]) {
        const own = parseOnboarding(b.trip.onboarding)?.route?.stops.find((x) => placeKey(x.name) === placeKey(stop.name))?.stay_pp_night;
        const next = { ...plan.stay_estimates };
        if (own && Object.keys(own).length) next[stop.id] = own; else delete next[stop.id];
        await source.update('trips', b.trip.id, { budget_plan: { ...plan, stay_estimates: next } });
      }
      await reload();
    } catch { /* conflito: a tela recarrega com o valor atual */ await reload(); } finally { setUndoing(false); }
  };
  const doc = stay?.document_id ? b.documents.find((d) => d.id === stay.document_id) : null;
  const openPoll = (b.polls ?? []).find((p) => p.stop_id === stop.id && p.target === 'stay' && p.status === 'open');
  const nightsCount = Math.max(1, daysBetween(stop.arrival_date, stop.departure_date));
  return (
    <section className={s.stay} aria-labelledby="hosp">
      <h3 id="hosp" className={s.stayLabel}>{stay?.status === 'booked' ? 'Hospedagem reservada' : stay ? 'Hospedagem anotada, sem reserva' : 'Falta o lugar para dormir'}</h3>
      {sleep ? (
        <p className={s.sleepBase}>
          Vocês escolheram dormir em <b>{sleep.name}</b>, mais barato: {sleep.minutes < 60 ? `${Math.round(sleep.minutes)} min` : `${String(Math.round(sleep.minutes / 6) / 10).replace('.', ',')}h`} até {stop.name}
          {sleep.commute_pp_day ? `, ida e volta ≈ ${formatMoney(sleep.commute_pp_day, cur, { compact: true })} por pessoa por dia` : ''}.{sleep.why ? ` ${sleep.why}` : ''}
          {canEdit ? <> <button type="button" className={s.textBtn} disabled={undoing} onClick={() => void sleepHere()}>Dormir em {stop.name}</button></> : null}
        </p>
      ) : null}
      {stay ? (
        <div className={s.stayNow}>
          <div className={s.stayNowHead}>
            <b>{stay.name}</b>
            <Badge tone={stay.status === 'booked' ? 'ok' : 'sun'}>{stay.status === 'booked' ? 'reservado' : 'sem reserva'}</Badge>
          </div>
          <span>
            {[stay.checkin_date ? `check-in ${dayMonth(stay.checkin_date)}${stay.checkin_time ? ` ${hhmm(stay.checkin_time)}` : ''}` : null, stay.checkout_date ? `check-out ${dayMonth(stay.checkout_date)}${stay.checkout_time ? ` ${hhmm(stay.checkout_time)}` : ''}` : null].filter(Boolean).join(' · ')}
          </span>
          {stay.price_cents != null ? <span className={s.inlineRow}><span className="num">{formatMoney(stay.price_cents, stay.price_currency ?? cur, { compact: true })} / noite</span>{stay.price_is_estimate ? <EstimateBadge /> : null}</span> : null}
          {stay.from_poll_id ? <span>Escolhida na votação</span> : null}
          <span className={s.stayLinks}>
            {doc ? <Link href={`${base}/turma/documentos?doc=${doc.id}`}>Comprovante: {doc.title}</Link> : null}
            {stay.link_url ? <a href={stay.link_url} target="_blank" rel="noopener noreferrer">Ver anúncio ↗</a> : null}
            {canEdit ? <button type="button" className={s.textBtn} onClick={onEditStay}>trocar</button> : null}
          </span>
        </div>
      ) : null}
      <>
          <span className={s.stayLead}>
            {stay?.status === 'booked'
              ? 'Já está reservado. Quer comparar? A busca vai pronta.'
              : `${nightsCount} ${nightsCount === 1 ? 'noite' : 'noites'} em ${sleep ? sleep.name : area ?? stop.name}, de ${dayMonth(stop.arrival_date)} a ${dayMonth(stop.departure_date)}, para ${filters.adults} ${filters.adults === 1 ? 'pessoa' : 'pessoas'}`}
          </span>
          <div className={s.stayChips} role="group" aria-label="Filtros da busca">
            <button type="button" className={s.dchip} onClick={onFilters}>{sleep ? sleep.name : area ? `${area}, ${stop.name}` : stop.name}</button>
            <button type="button" className={s.dchip} onClick={onFilters}>{dayMonth(stop.arrival_date)} → {dayMonth(stop.departure_date)}</button>
            <button type="button" className={s.dchip} onClick={onFilters}>{filters.adults} {filters.adults === 1 ? 'adulto' : 'adultos'} · 1 quarto</button>
            <button type="button" className={s.dchip} onClick={onFilters}>{filters.capCents ? `até ${formatMoney(Math.round(filters.capCents / 100) * 100, cur, { compact: true })} / noite` : 'sem teto por noite'}</button>
          </div>
          {links.length ? (
            <div className={s.stayBtns}>
              <a href={links[0].url} target="_blank" rel="noopener noreferrer" className={s.stayBtnMain}>
                Procurar no {links[0].label} <span aria-hidden="true">↗</span>
              </a>
              {links.length > 1 ? (
                <p className={s.stayAlt}>
                  ou no {links.slice(1).map((l, i) => (
                    <span key={l.label}>{i ? ' · ' : ''}<a href={l.url} target="_blank" rel="noopener noreferrer">{l.label}</a></span>
                  ))}
                </p>
              ) : null}
            </div>
          ) : null}
          <span className={s.stayNote}>
            {l10nFilterNote(where, filters.capCents)} A Trilha não reserva nada.
          </span>
          {canEdit ? (
            <form className={s.paste} onSubmit={(e) => { e.preventDefault(); if (linkOk) { onPaste(link.trim()); setLink(''); } }}>
              <span className={s.pasteTitle}>Achou um lugar?</span>
              <label className={s.pasteLabel} htmlFor={`paste-${stop.id}`}>Cole o link e a Trilha manda para a turma votar{openPoll ? ' (a votação já está aberta)' : ''}.</label>
              <div className={s.pasteRow}>
                <input id={`paste-${stop.id}`} type="url" inputMode="url" placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} />
                <Button type="submit" size="sm" variant="primary" disabled={!linkOk}>Mandar</Button>
              </div>
            </form>
          ) : null}
          {canEdit && !stay ? <button type="button" className={s.textBtnDark} onClick={onEditStay}>Já reservou? Registrar a hospedagem</button> : null}
      </>
    </section>
  );
}

function l10nFilterNote(area: string | null, cap: number | null): string {
  const bits = ['datas', 'pessoas'];
  if (area) bits.unshift('bairro');
  const base = `A busca vai com ${bits.join(', ')}`;
  return cap ? `${base} e o teto por noite (no Booking e no Airbnb).` : `${base}.`;
}

function FiltersSheet({ b, f, onClose }: { b: TripBundle; f: Filters; onClose: () => void }) {
  const [adults, setAdults] = useState(String(f.adults));
  const [cap, setCap] = useState(f.capCents ? formatMoneyTyping(String(Math.round(f.capCents / 100))) : '');
  const save = () => {
    const n = Math.max(1, Math.min(16, Number(adults) || 1));
    const c = parseMoneyInput(cap);
    f.set({ adults: n, capCents: c && c > 0 ? c : null });
    onClose();
  };
  return (
    <Sheet open onClose={onClose} title="Filtros da busca" description="Vale para os links de hospedagem desta sessão." footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={save}>Aplicar</Button></>}>
      <div className={s.sheetBody}>
        <Field label="Pessoas (adultos)"><input type="number" min={1} max={16} value={adults} onChange={(e) => setAdults(e.target.value)} /></Field>
        <Field label={`Teto por noite para a turma (${b.trip.base_currency})`} hint={nightlyCap(b) ? `O orçamento sugere até ${formatMoney(nightlyCap(b), b.trip.base_currency, { compact: true })}.` : 'Sem orçamento de hospedagem ainda.'}>
          <input inputMode="decimal" value={cap} placeholder="sem teto" onChange={(e) => setCap(formatMoneyTyping(e.target.value))} />
        </Field>
      </div>
    </Sheet>
  );
}

// ───────────── Mais sobre a parada ─────────────
// Cartões com o conteúdo à vista (em vez de sanfonas fechadas e vazias). Notas editam no próprio cartão.

function useWeather(stop: Stop) {
  const [wx, setWx] = useState<{ min: number; max: number; rain: number | null } | null>(null);
  useEffect(() => {
    if (stop.lat == null || stop.lng == null) return;
    const today = new Date().toISOString().slice(0, 10);
    const limit = new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10);
    if (stop.departure_date < today || stop.arrival_date > limit) return;
    const start = stop.arrival_date < today ? today : stop.arrival_date;
    const end = stop.departure_date > limit ? limit : stop.departure_date;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${stop.lat}&longitude=${stop.lng}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&start_date=${start}&end_date=${end}`;
    let alive = true;
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive || !j?.daily?.time?.length) return;
        const mins: number[] = j.daily.temperature_2m_min;
        const maxs: number[] = j.daily.temperature_2m_max;
        const rain: (number | null)[] = j.daily.precipitation_probability_max ?? [];
        const r = rain.filter((x): x is number => x != null);
        setWx({ min: Math.round(Math.min(...mins)), max: Math.round(Math.max(...maxs)), rain: r.length ? Math.max(...r) : null });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [stop.lat, stop.lng, stop.arrival_date, stop.departure_date]);
  return wx;
}

function MoreAbout({ b, stop, stops, index, canEdit, onTransport }: { b: TripBundle; stop: Stop; stops: Stop[]; index: number; canEdit: boolean; onTransport: () => void }) {
  const { base, source, reload } = useBundle();
  const { run } = useAction();
  const { online } = useAuth();
  const wx = useWeather(stop);
  const leg = legInto(b, stops, index);
  const t = leg?.transport ?? null;
  const docs = docsOfStop(b, stop.id);
  const ideas = b.journalEntries.filter((e) => e.kind === 'inspiracao' && e.stop_id === stop.id);
  const [notes, setNotes] = useState(stop.notes ?? '');
  const saveNotes = () => {
    if ((stop.notes ?? '') === notes) return;
    const v = notes.trim() || null;
    void run(() => source.update('stops', stop.id, { notes: v }, stop.version).then(reload), {
      success: 'Notas salvas.',
      onConflict: () => source.update('stops', stop.id, { notes: v }).then(reload),
    });
  };
  const cur = currencyForCountry(stop.country);
  const month = MONTH_NAME[Number(stop.arrival_date.slice(5, 7)) - 1]?.toLowerCase() ?? '';
  const facts = [
    cur ? `Moeda: ${currencyLabel(cur)}` : null,
    wx ? `Previsão: ${wx.min}° a ${wx.max}°${wx.rain != null ? `, chuva até ${wx.rain}%` : ''}` : null,
    stop.altitude_m != null && stop.altitude_m >= 1000 ? `Altitude: ${stop.altitude_m.toLocaleString('pt-BR')} m${stop.altitude_m >= 2500 ? ', vá com calma no primeiro dia' : ''}` : null,
  ].filter((x): x is string => !!x);
  const firstIdea = ideas[0];
  const ideaAuthor = firstIdea ? b.profiles.find((p) => p.id === firstIdea.author_id)?.display_name?.split(' ')[0] ?? null : null;

  return (
    <section className={s.section} aria-labelledby="mais-h">
      <h2 id="mais-h" className={s.h2}>Mais sobre {stop.name}</h2>
      <div className={s.moreGrid}>
        <button type="button" className={s.moreCard} onClick={onTransport} disabled={!leg && !canEdit}>
          <span className={s.moreTitle}><Icon name={leg?.mode === 'train' ? 'train' : leg?.mode === 'bus' ? 'bus' : 'plane'} size={18} />Como chegam</span>
          {leg ? (
            <>
              <span className={s.moreText}>{leg.title}{leg.duration ? ` · ${leg.duration}` : ''}{t?.depart_time ? ` · sai ${hhmm(t.depart_time)}` : ''}</span>
              <span className={leg.notBooked ? s.todoLine : s.okLine}>{leg.notBooked ? 'Falta comprar' : leg.booked ? `Comprado${t?.booking_ref ? ` · ${t.booking_ref}` : ''}` : 'Sem reserva'}</span>
            </>
          ) : <span className={s.moreText}>{index === 0 ? `A ida sai de ${b.trip.origin ?? 'casa'}. ${canEdit ? 'Toque para registrar.' : ''}` : 'Trecho ainda sem dados.'}</span>}
        </button>

        <Link href={`${base}/turma/diario?momento=antes`} className={s.moreCard}>
          <span className={s.moreTitle}><Icon name="heart" size={18} />Ideias da turma{ideas.length ? ` · ${ideas.length}` : ''}</span>
          {firstIdea ? (
            <>
              <span className={s.moreText}>“{firstIdea.title}”{ideaAuthor ? ` — ${ideaAuthor}` : ''}</span>
              {ideas.length > 1 ? <span className={s.mutedLine}>e mais {ideas.length - 1}. {(() => { const sc = inspirationScore(b, firstIdea.id); return sc.muito.length ? `${sc.muito.length} quer muito a primeira.` : ''; })()}</span> : null}
            </>
          ) : <span className={s.moreText}>Ninguém salvou ideias para {stop.name} no Diário ainda.</span>}
        </Link>

        <Link href={docs.length === 1 ? `${base}/turma/documentos?doc=${docs[0].id}` : `${base}/turma/documentos?parada=${stop.id}`} className={s.moreCard}>
          <span className={s.moreTitle}><Icon name="doc" size={18} />Documentos para {stop.name}</span>
          <span className={s.moreText}>{docs.length ? docs.slice(0, 3).map((d) => d.title).join(' · ') : 'Nada específico desta cidade. Toque para anexar.'}</span>
        </Link>

        {facts.length ? (
          <div className={s.moreCard}>
            <span className={s.moreTitle}><Icon name="info" size={18} />Bom saber{month ? ` em ${month}` : ''}</span>
            {facts.map((f) => <span key={f} className={s.moreText}>{f}</span>)}
          </div>
        ) : null}

        {canEdit || stop.notes ? (
          <div className={`${s.moreCard} ${s.notesCard}`}>
            <label className={s.moreTitle} htmlFor={`notes-${stop.id}`}><Icon name="edit" size={18} />Notas da parada</label>
            <textarea id={`notes-${stop.id}`} className={s.notes} rows={3} value={notes} readOnly={!canEdit} maxLength={4000}
              placeholder={canEdit ? 'Anote o que quiser sobre esta parada' : 'Sem notas'} onChange={(e) => setNotes(e.target.value)} onBlur={saveNotes} />
            {canEdit ? <span className={s.mutedLine}>{online ? 'Salva sozinho ao sair do campo.' : 'Precisa de internet para salvar.'}</span> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
