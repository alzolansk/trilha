'use client';
// Página da parada (planning §5.3, canvas Parada.dc.html): capa, fatos rápidos, onde ficar (bairros),
// hospedagem com a busca já filtrada, passeios (tabela `suggestions` + plano) e seções secundárias.
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ChooseDaySheet, EditStopSheet, StayOptionSheet, StaySheet, TransportSheet } from '../components/route/RouteSheets';
import { Badge, EstimateBadge } from '../components/ui/Badge';
import { Button, IconButton } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { useAction, useToast } from '../components/ui/feedback';
import { Field } from '../components/ui/Field';
import { formatMoneyTyping, parseMoneyInput } from '../components/ui/MoneyInput';
import { Photo, type PhotoData } from '../components/ui/Photo';
import { PhotoCard } from '../components/ui/PhotoCard';
import { AiNote, Icon } from '../components/ui/primitives';
import { AiBusy } from '../components/ui/Loader';
import { Sheet } from '../components/ui/Sheet';
import { useAuth } from '../data/AuthContext';
import { acceptSuggestion, voteSuggestions } from '../data/suggestionActions';
import { useBundle } from '../data/TripContext';
import { parseOnboarding, placeKey } from '../lib/onboarding';
import type { PhotoRef, Stop, Suggestion, TripBundle } from '../data/types';
import { useResolvedPhoto } from '../data/usePhoto';
import { callAi } from '../lib/ai/client';
import { currencyForCountry, currencyLabel } from '../lib/currency';
import { docsOfStop, sortedStops, stayOf, stopNights } from '../lib/derive';
import { activityCapForStop, fitOf, headcount, nightlyCap, rangeLabel, staySearchLinks } from '../lib/explore';
import { dateSpan, dayMonth, hhmm } from '../lib/format';
import { formatMoney } from '../lib/money';
import { inspirationScore } from '../lib/polls';
import { legInto, stopAreas, stopTours, type AreaItem, type Tour } from '../lib/route';
import { ruleTip } from '../lib/rules';
import { daysBetween } from '../lib/time';
import s from './parada.module.css';

const MONTH_NAME = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const EFFORT: Record<string, string> = { leve: 'leve', moderado: 'moderado', puxado: 'trilha puxada' };

type Open =
  | { kind: 'edit' } | { kind: 'stay' } | { kind: 'transport' } | { kind: 'filters' }
  | { kind: 'area'; item: AreaItem } | { kind: 'choose'; sg: Suggestion; day: string | null } | { kind: 'option'; link: string }
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
  const stay = stayOf(b, stop.id);
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

  return (
    <div className={s.page}>
      <section className={s.cover} aria-label={`Capa de ${stop.name}`}>
        <Photo photo={cover as PhotoData | null} place={stop.name} height="100%" radius="0" overlay priority className={s.coverPhoto}>
          <div className={s.coverTop}>
            <Link href={`${base}/roteiro`} className={s.back} aria-label="Voltar ao roteiro"><Icon name="back" size={22} /></Link>
            {canEdit ? <IconButton icon="edit" label="Editar parada" variant="light" onClick={() => setOpen({ kind: 'edit' })} /> : null}
          </div>
          <div className={s.coverBase}>
            <span className={s.coverLine}>Parada {index + 1} de {stops.length} · {dateSpan(stop.arrival_date, stop.departure_date)} · {stopNights(stop)}</span>
            <h1 className={s.coverName}>{stop.name}</h1>
          </div>
        </Photo>
      </section>

      <div className={s.body}>
        <Facts stop={stop} />
        {tip ? <AiNote by={tip.by} source={'source' in tip && tip.source ? tip.source : null}>{tip.text}</AiNote> : null}

        {nights > 0 ? (
          <section className={s.section} aria-labelledby="onde">
            <div className={s.head}>
              <h2 id="onde" className={s.h2}>Onde ficar</h2>
              <p className={s.lead}>Escolham o bairro antes do hotel.</p>
            </div>
            <div className={s.areas}>
              {chosen ? <ChosenArea item={chosen} resolve={resolve} onOpen={() => setOpen({ kind: 'area', item: chosen })} /> : null}
              {others.length ? (
                <div className={s.areaGrid}>
                  {others.map((a) => <AreaTile key={a.key} item={a} onOpen={() => setOpen({ kind: 'area', item: a })} />)}
                </div>
              ) : null}
              {!chosen && !others.length ? (
                <EmptyState compact icon="pin" title="Sem bairro ainda" text={resolve ? 'A Trilha sugere bairros com prós e contras. Ou escolha um em Editar parada.' : 'Quem organiza escolhe o bairro. A busca de hospedagem usa a cidade enquanto isso.'}
                  action={resolve ? <Button size="sm" variant="secondary" icon={asking ? undefined : 'sparkle'} onClick={() => void askSuggestions()} disabled={asking}>{asking ? <AiBusy steps={['Pedindo', 'Pensando', 'Montando']} /> : 'Sugerir bairros'}</Button> : undefined} />
              ) : null}
            </div>
            <StayCard b={b} stop={stop} area={chosen?.title ?? null} canEdit={canEdit} onEditStay={() => setOpen({ kind: 'stay' })} onFilters={() => setOpen({ kind: 'filters' })} onPaste={(link) => setOpen({ kind: 'option', link })} filters={filters} />
          </section>
        ) : null}

        <section className={s.section} aria-labelledby="passeios">
          <div className={s.headRow}>
            <h2 id="passeios" className={s.h2}>Passeios</h2>
            {tours.length ? <span className={s.count}><span className="num">{tours.length}</span> em {stop.name}</span> : null}
          </div>
          {tours.length ? (
            <div className={s.tours}>
              <BigTour t={tours[0]} b={b} stop={stop} resolve={resolve} canEdit={canEdit} onChoose={(sg, day) => setOpen({ kind: 'choose', sg, day })} />
              {tours.slice(1).map((t) => <TourRow key={t.key} t={t} b={b} stop={stop} canEdit={canEdit} onChoose={(sg, day) => setOpen({ kind: 'choose', sg, day })} />)}
            </div>
          ) : (
            <EmptyState compact icon="sparkle" title="Nenhum passeio ainda" text={resolve ? 'A Trilha sugere passeios que cabem nos dias livres e no teto da turma.' : 'Quando a turma ou a Trilha sugerirem passeios, aparecem aqui.'}
              action={resolve ? <Button size="sm" variant="secondary" icon={asking ? undefined : 'sparkle'} onClick={() => void askSuggestions()} disabled={asking}>{asking ? <AiBusy steps={['Pedindo', 'Pensando', 'Montando']} /> : 'Sugerir passeios'}</Button> : undefined} />
          )}
          {tours.length && resolve ? <Button size="sm" variant="ghost" icon={asking ? undefined : 'sparkle'} onClick={() => void askSuggestions()} disabled={asking} className={s.more}>{asking ? <AiBusy steps={['Pedindo', 'Pensando', 'Montando']} /> : 'Pedir mais sugestões'}</Button> : null}
          {tours.some((t) => t.estimate) ? <p className={s.honest}><EstimateBadge /> Valores por pessoa a partir de conhecimento geral, não de preços ao vivo. Confira antes de reservar.</p> : null}
        </section>

        <Secondary b={b} stop={stop} stops={stops} index={index} canEdit={canEdit} onTransport={() => setOpen({ kind: 'transport' })} />
      </div>

      {open?.kind === 'edit' ? <EditStopSheet stop={stop} onClose={() => setOpen(null)} onDeleted={() => router.replace(`${base}/roteiro`)} /> : null}
      {open?.kind === 'stay' ? <StaySheet stop={stop} stay={stay} onClose={() => setOpen(null)} /> : null}
      {open?.kind === 'transport' ? <TransportSheet stop={stop} t={b.transports.find((t) => t.stop_id === stop.id && !t.is_return) ?? null} onClose={() => setOpen(null)} /> : null}
      {open?.kind === 'choose' ? <ChooseDaySheet suggestion={open.sg} stop={stop} initial={open.day} onClose={() => setOpen(null)} /> : null}
      {open?.kind === 'option' ? <StayOptionSheet stop={stop} link={open.link} onClose={() => setOpen(null)} /> : null}
      {open?.kind === 'filters' ? <FiltersSheet b={b} f={filters} onClose={() => setOpen(null)} /> : null}
      {open?.kind === 'area' ? (
        <AreaSheet item={open.item} stop={stop} resolve={resolve} canEdit={canEdit} busy={busy} canVote={newAreas.length >= 2}
          onChoose={() => void chooseArea(open.item)} onVote={() => void voteAreas()} onClose={() => setOpen(null)} />
      ) : null}
    </div>
  );
}

// ───────────── Fatos rápidos ─────────────

/** Altitude, clima no mês (previsão Open-Meteo quando faltam ≤ 16 dias) e moeda. Sem dado: "—". */
function Facts({ stop }: { stop: Stop }) {
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
  const cur = currencyForCountry(stop.country);
  const month = MONTH_NAME[Number(stop.arrival_date.slice(5, 7)) - 1] ?? 'Clima';
  return (
    <div className={s.facts}>
      <div className={s.fact}><span>Altitude</span><b className="num">{stop.altitude_m != null ? `${stop.altitude_m.toLocaleString('pt-BR')} m` : '—'}</b></div>
      <div className={s.fact} title={wx ? 'Previsão Open-Meteo (CC BY 4.0), atualiza ao abrir' : 'Previsão só a partir de 16 dias antes'}>
        <span>{month}</span>
        <b className="num">{wx ? `${wx.min}° a ${wx.max}°` : '—'}</b>
        {wx?.rain != null ? <small>chuva até {wx.rain}%</small> : null}
      </div>
      <div className={s.fact}><span>Moeda</span><b>{cur ? currencyLabel(cur) : '—'}</b></div>
    </div>
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
      open onClose={onClose} title={item.title} description={item.chosen ? `Bairro escolhido em ${stop.name}` : `Bairro em ${stop.name}`}
      footer={canEdit ? (
        <>
          {canVote && !item.chosen ? <Button variant="secondary" onClick={onVote} disabled={busy}>Mandar bairros para votação</Button> : null}
          {!item.chosen ? <Button onClick={onChoose} disabled={busy}>Escolher este bairro</Button> : <Button variant="secondary" onClick={onClose}>Fechar</Button>}
        </>
      ) : undefined}
    >
      <div className={s.sheetBody}>
        <Photo photo={photo as PhotoData | null} place={item.title} ratio="16/9" />
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
  return (
    <section className={s.stay} aria-labelledby="hosp">
      <h3 id="hosp" className={s.stayLabel}>Hospedagem em {sleep ? sleep.name : area ?? stop.name}</h3>
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
          <span className={s.stayLead}>{stay?.status === 'booked' ? 'Já está reservado. Quer comparar? A busca vai pronta.' : 'A busca já vai pronta: só escolher o quarto.'}</span>
          <div className={s.stayChips} role="group" aria-label="Filtros da busca">
            <button type="button" className={s.dchip} onClick={onFilters}>{sleep ? sleep.name : area ? `${area}, ${stop.name}` : stop.name}</button>
            <button type="button" className={s.dchip} onClick={onFilters}>{dayMonth(stop.arrival_date)} → {dayMonth(stop.departure_date)}</button>
            <button type="button" className={s.dchip} onClick={onFilters}>{filters.adults} {filters.adults === 1 ? 'adulto' : 'adultos'} · 1 quarto</button>
            <button type="button" className={s.dchip} onClick={onFilters}>{filters.capCents ? `até ${formatMoney(Math.round(filters.capCents / 100) * 100, cur, { compact: true })} / noite` : 'sem teto por noite'}</button>
          </div>
          <div className={s.stayBtns}>
            {links.map((l, i) => (
              <a key={l.label} href={l.url} target="_blank" rel="noopener noreferrer" className={i === 0 ? s.stayBtnMain : s.stayBtn}>
                Abrir no {l.label}, já filtrado <span aria-hidden="true">↗</span>
              </a>
            ))}
          </div>
          <span className={s.stayNote}>
            {l10nFilterNote(where, filters.capCents)} A Trilha não reserva nada.
          </span>
          {canEdit ? (
            <form className={s.paste} onSubmit={(e) => { e.preventDefault(); if (linkOk) { onPaste(link.trim()); setLink(''); } }}>
              <label className={s.pasteLabel} htmlFor={`paste-${stop.id}`}>Achou um? Cole o link aqui e a Trilha manda para a votação{openPoll ? ' que já está aberta' : ''}.</label>
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

// ───────────── Passeios ─────────────

function costText(t: Tour): string | null {
  if (t.costHigh == null) return null;
  if (t.costHigh <= 0) return 'grátis';
  const mid = Math.round(((t.costLow ?? t.costHigh) + t.costHigh) / 2);
  return `≈ ${formatMoney(mid, t.currency, { compact: true })} / pessoa`;
}

function FitTag({ t, b, stop }: { t: Tour; b: TripBundle; stop: Stop }) {
  if (t.costHigh == null || t.currency !== b.trip.base_currency) return null;
  const cap = activityCapForStop(b, stop);
  const fit = fitOf(t.costLow ?? t.costHigh, t.costHigh, cap);
  if (fit === 'unknown' || fit === 'free') return null;
  return fit === 'fits' ? <Badge tone="ok">cabe</Badge> : <Badge tone="warn">passa {formatMoney(t.costHigh - cap, b.trip.base_currency, { compact: true })}</Badge>;
}

function StatusLine({ t }: { t: Tour }) {
  if (t.status.kind === 'roteiro') return <span className={s.okLine}>No roteiro · dia {t.status.day}</span>;
  if (t.status.kind === 'votacao') return <span className={s.brandLine}>Em votação{t.status.pos ? ` · ${t.status.pos} de ${t.status.total}` : ''}</span>;
  return null;
}

function tourMeta(t: Tour, stop: Stop): string {
  return [t.duration, t.effort ? EFFORT[t.effort] ?? t.effort : null, t.effort === 'puxado' && stop.altitude_m && stop.altitude_m >= 2500 ? 'altitude' : null, costText(t)].filter(Boolean).join(' · ');
}

function BigTour({ t, b, stop, resolve, canEdit, onChoose }: { t: Tour; b: TripBundle; stop: Stop; resolve: boolean; canEdit: boolean; onChoose: (sg: Suggestion, day: string | null) => void }) {
  const { source, reload } = useBundle();
  const photo = useResolvedPhoto(t.photo, t.photoQuery, resolve, (p: PhotoRef) => {
    if (t.activity) void source.update('activities', t.activity.id, { photo: p }, t.activity.version).then(reload).catch(() => undefined);
    else if (t.suggestion) void source.update('suggestions', t.suggestion.id, { payload: { ...t.suggestion.payload, photo: p } }, t.suggestion.version).then(reload).catch(() => undefined);
  });
  const badge = t.fans.length ? `${t.fans.join(' e ')} ${t.fans.length === 1 ? 'quer' : 'querem'} muito` : t.savedBy ? `${t.savedBy} salvou no Diário` : t.suggestion?.source === 'ai' && t.status.kind === 'nova' ? 'Sugestão da Trilha' : null;
  const slot = t.status.kind === 'nova' ? t.status.slot : null;
  return (
    <PhotoCard
      photo={photo as PhotoData | null}
      place={t.photoQuery}
      title={t.title}
      badge={badge ? <span className={s.fanBadge}>{badge}</span> : undefined}
      meta={<span className={s.metaRow}>{tourMeta(t, stop)}{t.estimate ? <EstimateBadge /> : null}<FitTag t={t} b={b} stop={stop} /></span>}
      actions={t.status.kind === 'nova' && canEdit && t.suggestion ? (
        <Button block onClick={() => onChoose(t.suggestion!, slot?.date ?? null)}>{slot ? `Pôr no dia ${slot.dayNumber}` : 'Escolher dia'}</Button>
      ) : undefined}
    >
      <StatusLine t={t} />
      {t.why && t.status.kind === 'nova' ? <p className={s.why}>{t.why}</p> : null}
    </PhotoCard>
  );
}

function TourRow({ t, b, stop, canEdit, onChoose }: { t: Tour; b: TripBundle; stop: Stop; canEdit: boolean; onChoose: (sg: Suggestion, day: string | null) => void }) {
  const slot = t.status.kind === 'nova' ? t.status.slot : null;
  return (
    <PhotoCard
      variant="row"
      photo={t.photo as PhotoData | null}
      place={t.photoQuery}
      title={t.title}
      meta={<span className={s.metaRow}>{tourMeta(t, stop)}{t.estimate ? <EstimateBadge /> : null}<FitTag t={t} b={b} stop={stop} /></span>}
      actions={t.status.kind === 'nova' && canEdit && t.suggestion ? (
        <button type="button" className={s.plusSoft} aria-label={`Adicionar ${t.title}${slot ? ` ao dia ${slot.dayNumber}` : ''}`} onClick={() => onChoose(t.suggestion!, slot?.date ?? null)}>
          <Icon name="plus" size={20} />
        </button>
      ) : undefined}
    >
      <StatusLine t={t} />
      {t.status.kind === 'nova' && slot ? <span className={s.mutedLine}>cabe no dia {slot.dayNumber}</span> : null}
    </PhotoCard>
  );
}

// ───────────── Seções secundárias ─────────────

function Secondary({ b, stop, stops, index, canEdit, onTransport }: { b: TripBundle; stop: Stop; stops: Stop[]; index: number; canEdit: boolean; onTransport: () => void }) {
  const { base, source, reload } = useBundle();
  const { run } = useAction();
  const { online } = useAuth();
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
  return (
    <section className={s.secondary} aria-label="Mais sobre a parada">
      <details className={s.details}>
        <summary>Como chego{leg ? <span>{leg.title}</span> : null}</summary>
        <div className={s.detailsBody}>
          {leg ? (
            <>
              <p className={s.text}>
                {leg.title}{leg.duration ? ` · ${leg.duration}` : ''}
                {t?.depart_time ? ` · sai ${hhmm(t.depart_time)}` : ''}{t?.arrive_time ? `, chega ${hhmm(t.arrive_time)}` : ''}
              </p>
              <p className={s.inlineRow}>
                {leg.priceCents != null ? <span className="num">{formatMoney(leg.priceCents, leg.currency, { compact: true })} / pessoa</span> : <span className={s.mutedLine}>sem valor</span>}
                {leg.priceCents != null && leg.estimate ? <EstimateBadge /> : null}
                {t?.booking_ref ? <Badge tone="ok">localizador {t.booking_ref}</Badge> : leg.notBooked ? <Badge tone="warn">não reservado</Badge> : null}
                {t?.seat ? <Badge tone="neutral">assento {t.seat}</Badge> : null}
              </p>
            </>
          ) : <p className={s.mutedLine}>Primeira parada: a ida sai de {b.trip.origin ?? 'casa'}.</p>}
          {canEdit ? <Button size="sm" variant="secondary" icon="edit" onClick={onTransport}>{t ? 'Editar trecho' : 'Adicionar trecho'}</Button> : null}
        </div>
      </details>

      <details className={s.details}>
        <summary>Documentos desta parada<span className="num">{docs.length || ''}</span></summary>
        <div className={s.detailsBody}>
          {docs.length ? (
            <div className={s.docList}>
              {docs.map((d) => <Link key={d.id} href={`${base}/turma/documentos?doc=${d.id}`} className={s.docLink}><Icon name="doc" size={16} />{d.title}</Link>)}
            </div>
          ) : <p className={s.mutedLine}>Nenhum documento ligado a {stop.name}.</p>}
          <Link href={`${base}/turma/documentos?parada=${stop.id}`} className={s.inlineLink}>Anexar um documento</Link>
        </div>
      </details>

      <details className={s.details}>
        <summary>Notas{stop.notes ? <span>tem notas</span> : null}</summary>
        <div className={s.detailsBody}>
          <Field label="Notas da parada" hint={canEdit ? (online ? 'Salva ao sair do campo.' : 'Precisa de internet para salvar.') : undefined}>
            <textarea rows={4} value={notes} readOnly={!canEdit} placeholder={canEdit ? 'Anote o que quiser sobre esta parada' : 'Sem notas'} maxLength={4000} onChange={(e) => setNotes(e.target.value)} onBlur={saveNotes} />
          </Field>
        </div>
      </details>

      <details className={s.details}>
        <summary>Ideias da turma<span className="num">{ideas.length || ''}</span></summary>
        <div className={s.detailsBody}>
          {ideas.length ? ideas.map((e) => {
            const sc = inspirationScore(b, e.id);
            return (
              <div key={e.id} className={s.idea}>
                <b>{e.title}</b>
                {e.body ? <span>{e.body}</span> : null}
                <span className={s.mutedLine}>{sc.muito.length ? `${sc.muito.length} quer muito` : 'sem reações'}{sc.topo.length ? ` · ${sc.topo.length} topa` : ''}</span>
              </div>
            );
          }) : <p className={s.mutedLine}>Ninguém salvou ideias para {stop.name} no Diário ainda.</p>}
          <Link href={`${base}/turma/diario?momento=antes`} className={s.inlineLink}>Abrir o Diário</Link>
        </div>
      </details>
    </section>
  );
}
