'use client';
// Roteiro (planning §5.2, canvas Roteiro.dc.html; redesign "caderno de viagem" de 11/2026): faixa de paradas,
// linha do tempo com cada parada como um capítulo, trechos como linhas finas entre elas, sugestões encaixadas
// nos dias, o mapa (?vista=mapa) e "Antes de ir", o único lugar que junta o que falta reservar.
// Sem selos nas linhas: ≈ antes do preço = estimativa; aro vazio = a reservar; check = reservado.
// A página de cada parada fica em /roteiro/[stopId] (Parada.tsx).
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivitySheet, AddStopSheet, ChooseDaySheet, EditStopSheet, TransportSheet } from '../components/route/RouteSheets';
import { Button, IconButton } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { useAction, useToast } from '../components/ui/feedback';
import type { IconName } from '../components/ui/icons.data';
import { ListRow } from '../components/ui/ListRow';
import { Photo, type PhotoData } from '../components/ui/Photo';
import { Icon } from '../components/ui/primitives';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { Segmented } from '../components/ui/Segmented';
import { Sheet } from '../components/ui/Sheet';
import { ScreenSkeleton } from '../components/ui/Skeleton';
import { locateActivities } from '../data/activityPlaces';
import { acceptSuggestion, voteSuggestions } from '../data/suggestionActions';
import { useBundle } from '../data/TripContext';
import type { Activity, Stop, Suggestion, Transport, TransportMode, TripBundle } from '../data/types';
import { activityMarks, needsLocate, placeOf } from '../lib/activityPlace';
import { sortedStops, stayOf, stopNights, straightKm } from '../lib/derive';
import { activityCapForStop } from '../lib/explore';
import { dateSpan, dayMonth, hhmm } from '../lib/format';
import { formatMoney } from '../lib/money';
import { bookingTodo, focusStopId, legInto, placeDaySuggestions, returnLeg, stayState, waitingCount, type BookingTodo, type Leg, type TodoGroup } from '../lib/route';
import { isRestDay, stopSlots, type DaySlot } from '../lib/suggestions';
import { daysBetween, todayIn } from '../lib/time';
import s from './roteiro.module.css';

const RouteMap = dynamic(() => import('../components/map/RouteMap'), { ssr: false, loading: () => <div className="skel" style={{ height: 420, borderRadius: 22 }} /> });

const MODE_ICON: Record<TransportMode, IconName> = { plane: 'plane', train: 'train', bus: 'bus', boat: 'route', car: 'route', walk: 'route', other: 'route' };

type Open =
  | { kind: 'add' }
  | { kind: 'transport'; stop: Stop }
  | { kind: 'return'; stop: Stop; t: Transport }
  | { kind: 'act'; stop: Stop; act: Activity | null; day?: string }
  | { kind: 'menu'; stop: Stop }
  | { kind: 'edit'; stop: Stop }
  | { kind: 'choose'; stop: Stop; sg: Suggestion; day: string | null }
  | null;

/** Desktop (> 820 px): lista e mapa lado a lado. */
function useWide() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 821px)');
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

export default function Roteiro() {
  const { bundle: b, base } = useBundle();
  const params = useSearchParams();
  const router = useRouter();
  const legacy = params.get('parada');
  // Link antigo (?parada=X) → página da parada (planning §4.3).
  useEffect(() => {
    if (legacy) router.replace(`${base}/roteiro/${encodeURIComponent(legacy)}`);
  }, [legacy, base, router]);
  if (legacy && b.stops.some((x) => x.id === legacy)) return <ScreenSkeleton />;
  return <RouteList />;
}

function RouteList() {
  const { bundle: b, base, canEdit, accent } = useBundle();
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const wide = useWide();
  const stops = useMemo(() => sortedStops(b), [b]);
  const vista = params.get('vista') === 'mapa' ? 'mapa' : 'lista';
  const today = todayIn(b.trip.departure_tz || 'America/Sao_Paulo');
  const focusKey = `trilha.roteiro.focus.${b.trip.id}`;
  const [focus, setFocusState] = useState<string | null>(null);
  const [open, setOpen] = useState<Open>(null);
  const refs = useRef(new Map<string, HTMLElement>());

  // Foco: o último escolhido nesta sessão (volta da Parada no mesmo lugar); senão a parada de hoje ou a próxima.
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = sessionStorage.getItem(focusKey);
    } catch {
      /* sem storage */
    }
    setFocusState((cur) => (cur && stops.some((x) => x.id === cur) ? cur : saved && stops.some((x) => x.id === saved) ? saved : focusStopId(stops, today)));
  }, [stops, focusKey, today]);

  const setFocus = (id: string, scroll = true) => {
    setFocusState(id);
    try {
      sessionStorage.setItem(focusKey, id);
    } catch {
      /* sem storage */
    }
    if (scroll) setTimeout(() => refs.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };
  const setVista = (v: 'lista' | 'mapa') => {
    const q = new URLSearchParams(params.toString());
    if (v === 'mapa') q.set('vista', 'mapa');
    else q.delete('vista');
    router.replace(q.size ? `${path}?${q}` : path, { scroll: false });
  };
  const openStop = (id: string) => router.push(`${base}/roteiro/${id}`);

  const totalDays = daysBetween(b.trip.start_date, b.trip.end_date) + 1;
  const waiting = waitingCount(b);
  const subtitle = stops.length
    ? [`${totalDays} dias`, `${stops.length} ${stops.length === 1 ? 'parada' : 'paradas'}`, waiting ? `${waiting} ${waiting === 1 ? 'sugestão esperando' : 'sugestões esperando'}` : null].filter(Boolean).join(' · ')
    : 'Nenhuma parada ainda.';
  const km = straightKm(stops);
  // Passeios no mapa: pino, trajeto (trem panorâmico, barco) e ligação com a parada de onde saem.
  const marks = useMemo(() => activityMarks(b), [b]);
  const todo = useMemo(() => bookingTodo(b, stops), [b, stops]);
  const ret = returnLeg(b, stops);
  const hasReturn = !!ret?.transport;
  // "Antes de ir": cada linha leva ao lugar de resolver (trecho → janela do trecho; hospedagem → página da parada).
  const openTodo = (g: TodoGroup) => {
    if (g.key === 'stay') return g.stops[0] ? openStop(g.stops[0].id) : undefined;
    const t = g.legs[0]?.transport;
    if (!t || !canEdit) return;
    if (t.is_return) setOpen({ kind: 'return', stop: stops[stops.length - 1], t });
    else {
      const st = stops.find((x) => x.id === t.stop_id);
      if (st) setOpen({ kind: 'transport', stop: st });
    }
  };
  const openAct = (id: string) => {
    const a = b.activities.find((x) => x.id === id);
    const st = a ? stops.find((x) => x.id === a.stop_id) : null;
    if (a && st) setOpen({ kind: 'act', stop: st, act: a });
  };
  const mapNote = (
    <>
      <MapLegend marks={marks} />
      <p className={s.mapNote}>
        A linha liga as paradas em ordem e não é o trajeto real.
        {km.km > 0 ? ` ${km.km.toLocaleString('pt-BR')} km em linha reta${km.complete ? '' : ' (só entre paradas com coordenadas)'}.` : ''}
        {marks.some((m) => m.path && m.by === 'ai') ? ' Trajetos de passeio são aproximados (estimados pela Trilha).' : ''}
        {marks.some((m) => !m.far) ? ' Aproxime o mapa para ver os passeios dentro de cada cidade.' : ''}
        {stops.some((x) => x.lat == null) ? ' Paradas sem coordenadas não aparecem: edite a parada e escolha o lugar na busca.' : ''}
      </p>
      {canEdit ? <LocateActivities /> : null}
    </>
  );

  return (
    <div className={s.page}>
      <ScreenHeader
        title="Roteiro"
        subtitle={subtitle}
        action={stops.length && !wide ? <Segmented label="Ver como" value={vista} onChange={setVista} options={[{ value: 'lista', label: 'Lista' }, { value: 'mapa', label: 'Mapa' }]} /> : canEdit && wide ? <Button icon="plus" onClick={() => setOpen({ kind: 'add' })}>Adicionar parada</Button> : null}
      />

      {!stops.length ? (
        <EmptyState
          icon="route"
          title="Nenhuma parada ainda"
          text={canEdit ? 'Comece pela primeira cidade: nome e datas. Trecho, hospedagem e passeios vêm depois.' : 'Quem organiza ainda não adicionou paradas.'}
          action={canEdit ? <Button icon="plus" onClick={() => setOpen({ kind: 'add' })}>Adicionar parada</Button> : undefined}
        />
      ) : vista === 'mapa' && !wide ? (
        <section className={s.mapFull} aria-label="Mapa da trilha">
          <RouteMap stops={stops} activities={marks} accent={accent} height="calc(100dvh - 300px)" onOpen={openStop} onOpenActivity={openAct} focusId={focus} />
          {mapNote}
        </section>
      ) : (
        <>
          <nav className={s.strip} aria-label="Paradas">
            {stops.map((st) => (
              <button key={st.id} type="button" className={s.stripItem} aria-current={st.id === focus ? 'true' : undefined} onClick={() => setFocus(st.id)}>
                <Photo photo={st.photo?.url ? (st.photo as PhotoData) : null} place={st.name} alt="" height={76} radius="18px" caption={false} className={s.stripThumb} />
                <span className={s.stripName}>{st.name}</span>
              </button>
            ))}
            {canEdit ? (
              <button type="button" className={s.stripItem} onClick={() => setOpen({ kind: 'add' })}>
                <span className={s.stripAdd} aria-hidden="true"><Icon name="plus" size={24} /></span>
                <span className={s.stripName}>parada</span>
                <span className="sr">Adicionar parada</span>
              </button>
            ) : null}
          </nav>

          {todo.pending ? (
            <a href="#antes-de-ir" className={s.todoPill}>
              <span className={s.ring} aria-hidden="true" />
              {todo.pending} {todo.pending === 1 ? 'reserva' : 'reservas'} antes de ir
              <Icon name="arrow" size={16} />
            </a>
          ) : null}

          <div className={s.layout}>
            <div className={s.list}>
              {stops.map((st, i) => {
                const leg = legInto(b, stops, i);
                const isFocus = st.id === focus;
                return (
                  <div key={st.id} className={s.block} ref={(el) => { if (el) refs.current.set(st.id, el); else refs.current.delete(st.id); }}>
                    {leg ? <LegLine leg={leg} first={i === 0} onEdit={canEdit ? () => setOpen({ kind: 'transport', stop: st }) : undefined} /> : null}
                    <div className={s.row}>
                      <div className={s.rail} aria-hidden="true">
                        <span className={s.stopNode} data-active={isFocus || undefined}>{i + 1}</span>
                        <span className={s.railLine} data-k={isFocus ? 'solid' : undefined} data-hide={i === stops.length - 1 && !hasReturn ? '' : undefined} />
                      </div>
                      {isFocus ? (
                        <StopFocus b={b} stop={st} base={base} canEdit={canEdit} setOpen={setOpen} />
                      ) : (
                        <StopCompact b={b} stop={st} onFocus={() => setFocus(st.id)} onMenu={canEdit ? () => setOpen({ kind: 'menu', stop: st }) : undefined} />
                      )}
                    </div>
                  </div>
                );
              })}
              {hasReturn ? (
                <div className={s.block}><LegLine leg={ret!} end onEdit={canEdit ? () => setOpen({ kind: 'return', stop: stops[stops.length - 1], t: ret!.transport! }) : undefined} /></div>
              ) : null}
              <p className={s.key}>
                <span><span aria-hidden="true">≈</span> valor estimado</span>
                <span><span className={s.ring} aria-hidden="true" /> a reservar</span>
                <span><span className={s.tick} aria-hidden="true"><Icon name="check" size={10} /></span> reservado</span>
              </p>
              {!wide ? <BeforeYouGo todo={todo} canEdit={canEdit} onOpen={openTodo} /> : null}
            </div>
            {wide ? (
              <aside className={s.aside} aria-label="Mapa da trilha">
                <RouteMap stops={stops} activities={marks} accent={accent} height="min(56vh, 520px)" onOpen={openStop} onOpenActivity={openAct} focusId={focus} />
                {mapNote}
                <BeforeYouGo todo={todo} canEdit={canEdit} onOpen={openTodo} />
              </aside>
            ) : null}
          </div>
        </>
      )}

      <AddStopSheet open={open?.kind === 'add'} onClose={() => setOpen(null)} stops={stops} onCreated={(id) => setFocus(id)} />
      {open?.kind === 'transport' ? <TransportSheet stop={open.stop} t={b.transports.find((t) => t.stop_id === open.stop.id && !t.is_return) ?? null} onClose={() => setOpen(null)} /> : null}
      {open?.kind === 'return' ? <TransportSheet stop={open.stop} t={open.t} onClose={() => setOpen(null)} /> : null}
      {open?.kind === 'act' ? <ActivitySheet stop={open.stop} act={open.act} day={open.day} onClose={() => setOpen(null)} /> : null}
      {open?.kind === 'edit' ? <EditStopSheet stop={open.stop} onClose={() => setOpen(null)} /> : null}
      {open?.kind === 'choose' ? <ChooseDaySheet suggestion={open.sg} stop={open.stop} initial={open.day} onClose={() => setOpen(null)} /> : null}
      {open?.kind === 'menu' ? <StopMenu stop={open.stop} stops={stops} base={base} onClose={() => setOpen(null)} onEdit={() => setOpen({ kind: 'edit', stop: open.stop })} onTransport={() => setOpen({ kind: 'transport', stop: open.stop })} /> : null}
    </div>
  );
}

/** Legenda do mapa: só o que está desenhado. */
function MapLegend({ marks }: { marks: ReturnType<typeof activityMarks> }) {
  if (!marks.length) return null;
  return (
    <div className={s.legend} aria-hidden="true">
      <span><i data-k="stop" />paradas</span>
      <span><i data-k="act" />passeios</span>
      {marks.some((m) => m.path) ? <span><i data-k="path" />trajeto de passeio</span> : null}
      {marks.some((m) => m.far) ? <span><i data-k="link" />saindo da parada</span> : null}
    </div>
  );
}

/**
 * "Pôr passeios no mapa": a IA diz onde cada atividade acontece (e o trajeto, se for um percurso) e o app
 * grava em activities.place. Aparece só para quem edita e só quando há atividade ainda não procurada.
 */
function LocateActivities() {
  const { bundle: b, source, reload } = useBundle();
  const { run, busy } = useAction();
  const toast = useToast();
  const pending = b.activities.filter(needsLocate);
  if (!pending.length || source.kind === 'demo') return null;
  const offMap = pending.filter((a) => !placeOf(b, a)).length;
  const go = () => run(async () => {
    const r = await locateActivities(source, b.trip.id);
    await reload();
    toast(r.placed
      ? `${r.placed} ${r.placed === 1 ? 'passeio entrou' : 'passeios entraram'} no mapa${r.none ? `; ${r.none} não ${r.none === 1 ? 'é um lugar' : 'são lugares'} (ex.: tarde livre)` : ''}.`
      : 'Nenhum passeio novo com lugar no mapa. Dá pra escolher o lugar na janela da atividade.');
  });
  return (
    <div className={s.locate}>
      <span>
        {offMap ? `${offMap} ${offMap === 1 ? 'passeio ainda não aparece' : 'passeios ainda não aparecem'} no mapa.` : 'A Trilha pode desenhar o trajeto dos passeios (trem panorâmico, barco, bate-volta).'}
      </span>
      <Button size="sm" variant="secondary" icon="pin" onClick={() => void go()} disabled={busy}>{busy ? 'Procurando…' : 'Pôr passeios no mapa'}</Button>
    </div>
  );
}

/** "≈ R$ 1.450 / pessoa": o ≈ marca estimativa (planning decisão 3) sem selo; leitor de tela ouve "estimativa". */
function Price({ cents, currency, estimate, suffix = ' / pessoa' }: { cents: number; currency: string; estimate: boolean; suffix?: string }) {
  return (
    <span className={`${s.price} num`}>
      {estimate ? <><span aria-hidden="true">≈ </span><span className="sr">estimativa de </span></> : null}
      {formatMoney(cents, currency, { compact: true })}{suffix}
    </span>
  );
}

/** Aro vazio (a reservar) ou check (reservado). O texto fica para o leitor de tela; a legenda explica no fim da lista. */
function BookMark({ booked, label }: { booked: boolean; label?: string }) {
  return booked ? (
    <span className={s.markWrap}><span className={s.tick} aria-hidden="true"><Icon name="check" size={10} /></span><span className="sr">{label ?? 'reservado'}</span></span>
  ) : (
    <span className={s.markWrap}><span className={s.ring} aria-hidden="true" /><span className="sr">{label ?? 'a reservar'}</span></span>
  );
}

/** Trecho entre paradas: linha fina na linha do tempo — "5 jun · Trem Roma → Costa Amalfitana · 2h · ≈ R$ 165 / pessoa ○". */
function LegLine({ leg, onEdit, first = false, end = false }: { leg: Leg; onEdit?: () => void; first?: boolean; end?: boolean }) {
  const body = (
    <span className={s.legText}>
      <span className={s.legTitle}>{leg.date ? `${dayMonth(leg.date)} · ` : ''}{leg.title}</span>
      {leg.duration ? <span>{leg.duration}</span> : null}
      {leg.priceCents != null ? <Price cents={leg.priceCents} currency={leg.currency} estimate={leg.estimate} /> : null}
      {leg.notBooked || leg.booked ? <BookMark booked={leg.booked} /> : null}
      {!leg.transport && onEdit ? <span className={s.legDefine}>definir trecho</span> : null}
    </span>
  );
  return (
    <div className={s.row} data-kind="leg">
      <div className={s.rail} aria-hidden="true">
        <span className={s.railLine} data-hide={first ? '' : undefined} />
        <span className={s.legNode}><Icon name={MODE_ICON[leg.mode]} size={16} /></span>
        <span className={s.railLine} data-hide={end ? '' : undefined} />
      </div>
      {onEdit ? (
        <button type="button" className={s.leg} onClick={onEdit} aria-label={`Trecho: ${leg.title}. Editar`}>{body}</button>
      ) : (
        <div className={s.leg}>{body}</div>
      )}
    </div>
  );
}

/** Onde dormir, em texto: "dorme em Hotel X ✓", "hospedagem em votação" ou "onde dormir ○ a definir". */
function StayLine({ b, stop }: { b: TripBundle; stop: Stop }) {
  const state = stayState(b, stop);
  if (state === 'none') return null;
  if (state === 'booked') {
    const name = stayOf(b, stop.id)?.name?.trim();
    return <span className={s.stayLine}>{name ? `dorme em ${name}` : 'hospedagem reservada'} <BookMark booked label="reservada" /></span>;
  }
  if (state === 'voting') return <span className={`${s.stayLine} ${s.voting}`}>hospedagem em votação</span>;
  return <span className={s.stayLine}>onde dormir <span className={s.todoText}><span className={s.ring} aria-hidden="true" /> a definir</span></span>;
}

/** Parada fora de foco: um capítulo fechado — foto, datas, nome grande e o que falta (dias sem plano, onde dormir). */
function StopCompact({ b, stop, onFocus, onMenu }: { b: TripBundle; stop: Stop; onFocus: () => void; onMenu?: () => void }) {
  const open = stopSlots(b, stop).filter((x) => x.state === 'vazio').length;
  const place = stop.stay_base?.name ? `dorme em ${stop.stay_base.name}` : stop.area;
  return (
    <article className={s.compact} aria-label={`Parada ${stop.name}`}>
      <button type="button" className={s.compactMain} onClick={onFocus} aria-expanded={false}>
        <span className={s.compactThumb}>
          <Photo photo={stop.photo?.url ? (stop.photo as PhotoData) : null} place={stop.name} alt="" height="100%" radius="14px" caption={false} />
        </span>
        <span className={s.compactText}>
          {/* nome primeiro (é o que o leitor de tela anuncia); as datas sobem por CSS */}
          <span className={s.compactName}>{stop.name}</span>
          <span className={s.compactEyebrow}>{[dateSpan(stop.arrival_date, stop.departure_date), stopNights(stop), place].filter(Boolean).join(' · ')}</span>
          <span className={s.compactSub}>
            {open ? <span>{open} {open === 1 ? 'dia para montar' : 'dias para montar'}</span> : null}
            <StayLine b={b} stop={stop} />
          </span>
        </span>
      </button>
      {onMenu ? <IconButton icon="more" label={`Mais ações de ${stop.name}`} variant="ghost" onClick={onMenu} /> : null}
    </article>
  );
}

/** Parada em foco: capítulo aberto — capa (leva à página da parada) e os dias com atividades e sugestões. */
function StopFocus({ b, stop, base, canEdit, setOpen }: { b: TripBundle; stop: Stop; base: string; canEdit: boolean; setOpen: (o: Open) => void }) {
  const slots = stopSlots(b, stop);
  const placed = useMemo(() => placeDaySuggestions(b, stop, activityCapForStop(b, stop)), [b, stop]);
  const tip = stop.stay_base?.name ? `Dormem em ${stop.stay_base.name}` : stop.area ? `Dica: fiquem em ${stop.area}` : null;
  return (
    <article className={s.focus} aria-label={`Parada ${stop.name}`}>
      <Link href={`${base}/roteiro/${stop.id}`} className={s.cover} aria-label={`Ver a cidade: ${stop.name}${stop.area ? `, fiquem em ${stop.area}` : ''}`}>
        <Photo photo={stop.photo?.url ? (stop.photo as PhotoData) : null} place={stop.name} height="100%" radius="0" overlay>
          <div className={s.coverBase}>
            <div className={s.coverTitles}>
              <span className={s.coverLine}>{dateSpan(stop.arrival_date, stop.departure_date)} · {stopNights(stop)}</span>
              <h2 className={s.coverName}>{stop.name}</h2>
            </div>
            <div className={s.coverSide}>
              {tip ? <span className={s.coverTip}>{tip}</span> : null}
              <span className={s.chipDark}>Ver a cidade →</span>
            </div>
          </div>
        </Photo>
      </Link>
      <div className={s.focusTools}>
        <StayLine b={b} stop={stop} />
        {canEdit ? (
          <span className={s.focusActions}>
            <Button size="sm" variant="ghost" icon="edit" onClick={() => setOpen({ kind: 'edit', stop })}>Editar parada</Button>
            <IconButton icon="more" label={`Mais ações de ${stop.name}`} variant="ghost" onClick={() => setOpen({ kind: 'menu', stop })} />
          </span>
        ) : null}
      </div>
      <div className={s.days}>
        {slots.map((slot) => (
          <DayRow key={slot.date} b={b} stop={stop} slot={slot} suggestions={placed.get(slot.date) ?? []} canEdit={canEdit} setOpen={setOpen} />
        ))}
        {canEdit ? <Button variant="dashed" size="sm" icon="plus" block onClick={() => setOpen({ kind: 'act', stop, act: null })} className={s.addAct}>Atividade</Button> : null}
      </div>
    </article>
  );
}

/** Rótulo curto do dia: chegada, partida, livre, cheio. */
function dayLabel(stop: Stop, slot: DaySlot): string | null {
  if (slot.date === stop.arrival_date) return 'chegada';
  if (slot.state === 'viagem') return 'partida';
  if (slot.state === 'vazio') return 'livre';
  if (slot.state === 'cheio') return 'cheio';
  return null;
}

/** Barrinha do dia: um traço por atividade (cheio), um tracejado para a sugestão que cabe, o resto vazio. */
function DayBar({ count, hint }: { count: number; hint: boolean }) {
  const n = Math.max(2, count + (hint ? 1 : 0));
  return (
    <span className={s.bar} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => <i key={i} data-k={i < count ? 'on' : i === count && hint ? 'hint' : undefined} />)}
    </span>
  );
}

function DayRow({ b, stop, slot, suggestions, canEdit, setOpen }: { b: TripBundle; stop: Stop; slot: DaySlot; suggestions: Suggestion[]; canEdit: boolean; setOpen: (o: Open) => void }) {
  const { source, reload, me } = useBundle();
  const { run, busy } = useAction();
  const acts = b.activities.filter((a) => a.stop_id === stop.id && a.day === slot.date).sort((x, y) => (x.time ?? '99').localeCompare(y.time ?? '99') || x.position - y.position);
  const accept = (sg: Suggestion) =>
    run(async () => {
      await acceptSuggestion(source, b, sg, slot.date);
      await reload();
    }, { success: `${sg.payload.title} entrou no dia ${slot.dayNumber}.` });
  const vote = (list: Suggestion[]) =>
    run(async () => {
      await voteSuggestions(source, b, list, me);
      await reload();
    }, { success: 'Votação criada com os preços. A turma vota em Turma › Votos.' });
  const empty = !acts.length;
  const inlineOne = suggestions.length === 1 || (!!suggestions.length && slot.state === 'folga');
  const label = dayLabel(stop, slot);

  return (
    <div className={s.day}>
      <div className={s.dayHead} aria-hidden="true">
        <span className={s.dayDate}>{dayMonth(slot.date)}</span>
        <span className={s.dayLabel}>Dia {slot.dayNumber}{label ? ` · ${label}` : ''}</span>
      </div>
      <div className={s.dayBody}>
        <span className="sr">Dia {slot.dayNumber}</span>
        {slot.state === 'vazio' || slot.state === 'folga' || slot.state === 'cheio' ? <DayBar count={acts.length} hint={inlineOne} /> : null}
        {acts.map((a) => {
          const inner = (
            <>
              <span className={s.actTitle}>{a.time ? <span className={`${s.actTime} num`}>{hhmm(a.time)}</span> : null}{a.title}</span>
              {a.notes ? <span className={s.actNote}>{a.notes}</span> : null}
            </>
          );
          return canEdit ? (
            <button key={a.id} type="button" className={s.act} onClick={() => setOpen({ kind: 'act', stop, act: a })} aria-label={`${a.title}. Editar atividade`}>{inner}</button>
          ) : (
            <div key={a.id} className={s.act}>{inner}</div>
          );
        })}
        {empty && slot.state === 'aclimatar' ? <><span className={s.actTitle}>Chegada e aclimatação</span><span className={s.actNote}>Primeiro dia acima de 2.500 m: nada de esforço.</span></> : null}
        {empty && slot.state === 'viagem' ? <span className={`${s.actTitle} ${s.muted}`}>Dia de viagem</span> : null}
        {empty && slot.state === 'vazio' ? <span className={s.emptyDay}>Dia livre, ainda sem plano.</span> : null}

        {inlineOne ? (
          <Inline sg={suggestions[0]} slot={slot} free={slot.state === 'folga' ? freeLabel(acts) : null} canEdit={canEdit} busy={busy} onAdd={() => void accept(suggestions[0])} />
        ) : suggestions.length > 1 ? (
          <div className={s.options}>
            <span className={s.optionsLead}>A Trilha separou {suggestions.length} opções para esse dia:</span>
            <div className={s.minis}>
              {suggestions.map((sg) => {
                const card = (
                  <>
                    <Photo photo={sg.payload.photo?.url ? (sg.payload.photo as PhotoData) : null} place={sg.payload.photo_query ?? sg.payload.title} alt="" height={70} radius="0" caption={false} />
                    <span className={s.miniText}><b>{sg.payload.title}</b><span>{fitLabel(sg)}</span></span>
                  </>
                );
                return canEdit ? (
                  <button key={sg.id} type="button" className={s.mini} onClick={() => setOpen({ kind: 'choose', stop, sg, day: slot.date })} aria-label={`${sg.payload.title}: pôr no roteiro`}>{card}</button>
                ) : (
                  <div key={sg.id} className={s.mini}>{card}</div>
                );
              })}
            </div>
            {canEdit ? <Button variant="dark" size="sm" onClick={() => void vote(suggestions)} disabled={busy}>Mandar as {suggestions.length} para votação</Button> : null}
          </div>
        ) : null}

        {isRestDay(stop, slot.date) && !empty ? <span className={s.actNote}>Chegada a {stop.altitude_m?.toLocaleString('pt-BR')} m: dia leve pra aclimatar.</span> : null}
      </div>
    </div>
  );
}

const FIT: Record<string, string> = { manha: 'manhã', tarde: 'tarde', noite: 'noite', dia_todo: 'dia todo' };
const fitLabel = (sg: Suggestion) => (sg.payload.day_fit ? FIT[sg.payload.day_fit] : sg.payload.duration ?? '');
/** "tarde livre": quando a atividade do dia tem horário de manhã, sobra a tarde (e vice-versa). */
function freeLabel(acts: Activity[]): string {
  const t = acts.find((a) => a.time)?.time;
  if (!t) return 'tempo livre';
  return Number(t.slice(0, 2)) < 12 ? 'tarde livre' : 'manhã livre';
}

/** Sugestão tracejada dentro do dia, com o botão + de 44 px. */
function Inline({ sg, slot, free, canEdit, busy, onAdd }: { sg: Suggestion; slot: DaySlot; free: string | null; canEdit: boolean; busy: boolean; onAdd: () => void }) {
  const p = sg.payload;
  const mid = p.cost_high != null && p.cost_high > 0 ? Math.round(((p.cost_low ?? p.cost_high) + p.cost_high) / 2) : null;
  const reason = free ? `Cabe ${free === 'tempo livre' ? 'no tempo livre' : `na ${free}`}` : `Sugestão · ${fitLabel(sg)}`;
  return (
    <div className={s.inline}>
      <Photo photo={p.photo?.url ? (p.photo as PhotoData) : null} place={p.photo_query ?? p.title} alt="" height={56} radius="12px" caption={false} className={s.inlineThumb} />
      <span className={s.inlineText}>
        <span className={s.inlineReason}>{reason}</span>
        <b>{p.title}</b>
        <span className={s.inlineMeta}>
          {p.duration ? <span>{p.duration}</span> : null}
          {mid != null ? <Price cents={mid} currency={p.currency ?? 'BRL'} estimate suffix="/pessoa" /> : p.cost_high === 0 ? <span>grátis</span> : null}
        </span>
      </span>
      {canEdit ? (
        <button type="button" className={s.plus} onClick={onAdd} disabled={busy} aria-label={`Adicionar ${p.title} ao dia ${slot.dayNumber}`}>
          <Icon name="plus" size={20} />
        </button>
      ) : null}
    </div>
  );
}

const TODO_NOUN: Record<TodoGroup['key'], [string, string]> = {
  plane: ['voo', 'voos'], train: ['trem', 'trens'], bus: ['ônibus', 'ônibus'], boat: ['barco', 'barcos'], stay: ['hospedagem', 'hospedagens'],
};
const TODO_ICON: Record<TodoGroup['key'], IconName> = { plane: 'plane', train: 'train', bus: 'bus', boat: 'route', stay: 'bed' };

/**
 * "Antes de ir": o único lugar que junta o que falta reservar (as linhas do roteiro só mostram o aro).
 * Cada grupo leva ao lugar de resolver; a soma é por pessoa e só aparece quando todos os trechos têm preço.
 */
function BeforeYouGo({ todo, canEdit, onOpen }: { todo: BookingTodo; canEdit: boolean; onOpen: (g: TodoGroup) => void }) {
  const total = todo.pending + todo.done;
  if (!total) return null;
  return (
    <section id="antes-de-ir" className={s.todo} aria-labelledby="antes-de-ir-titulo">
      <div className={s.todoHead}>
        <h2 id="antes-de-ir-titulo" className={s.todoTitle}>Antes de ir</h2>
        <span className={s.todoCount}>{todo.done} de {total} {total === 1 ? 'reservado' : 'reservados'}</span>
      </div>
      <span className={s.todoBar} aria-hidden="true">
        {total <= 24 ? Array.from({ length: total }, (_, i) => <i key={i} data-k={i < todo.done ? 'on' : undefined} />) : <i data-k="on" style={{ flex: 'none', width: `${(todo.done / total) * 100}%` }} />}
      </span>
      {todo.pending ? (
        <ul className={s.todoList}>
          {todo.groups.map((g) => {
            const [one, many] = TODO_NOUN[g.key];
            const detail = g.key === 'stay' ? g.stops.map((x) => x.name).join(', ') : g.legs.map((l) => l.title.replace(/^\S+ /, '')).join(', ');
            const inner = (
              <>
                <Icon name={TODO_ICON[g.key]} size={20} className={s.todoIcon} />
                <span className={s.todoText2}>
                  <span className={s.todoName}>{g.count} {g.count === 1 ? one : many}</span>
                  <span className={s.todoDetail}>{detail}</span>
                </span>
                {g.totalCents != null && g.currency ? <Price cents={g.totalCents} currency={g.currency} estimate={g.estimate} suffix="" /> : g.key === 'stay' ? <span className={s.todoDetail}>escolher</span> : null}
                {g.key === 'stay' || canEdit ? <Icon name="next" size={18} className={s.todoIcon} /> : null}
              </>
            );
            return (
              <li key={g.key}>
                {g.key === 'stay' || canEdit ? (
                  <button type="button" className={s.todoRow} onClick={() => onOpen(g)}>{inner}</button>
                ) : (
                  <div className={s.todoRow}>{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={s.todoDone}><span className={s.tick} aria-hidden="true"><Icon name="check" size={10} /></span> Tudo reservado.</p>
      )}
      <p className={s.todoNote}>Valores por pessoa. Com ≈, são estimativas até a reserva.</p>
    </section>
  );
}

/** "⋯" da parada: abrir, editar, trecho e mover para cima/baixo. */
function StopMenu({ stop, stops, base, onClose, onEdit, onTransport }: { stop: Stop; stops: Stop[]; base: string; onClose: () => void; onEdit: () => void; onTransport: () => void }) {
  const { source, reload } = useBundle();
  const { run, busy } = useAction();
  const i = stops.findIndex((x) => x.id === stop.id);
  const move = (d: -1 | 1) =>
    run(async () => {
      const a = stops[i];
      const c = stops[i + d];
      await source.update('stops', a.id, { position: c.position === a.position ? a.position + d : c.position }, a.version);
      await source.update('stops', c.id, { position: a.position }, c.version);
      await reload();
      onClose();
    }, { success: `${stop.name} foi para ${d < 0 ? 'cima' : 'baixo'}.` });
  return (
    <Sheet open onClose={onClose} title={stop.name} description={`Parada ${i + 1} de ${stops.length}`}>
      <div className={s.menu}>
        <ListRow icon="pin" title="Abrir a parada" href={`${base}/roteiro/${stop.id}`} />
        <ListRow icon="edit" title="Editar parada" onClick={onEdit} />
        <ListRow icon="route" title="Como chego (trecho)" onClick={onTransport} />
        {i > 0 ? <ListRow icon="back" title="Mover para cima" onClick={busy ? undefined : () => void move(-1)} /> : null}
        {i < stops.length - 1 ? <ListRow icon="next" title="Mover para baixo" onClick={busy ? undefined : () => void move(1)} /> : null}
      </div>
    </Sheet>
  );
}
