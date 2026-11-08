'use client';
// Roteiro (planning §5.2, canvas Roteiro.dc.html): faixa de paradas, parada em foco com capa e dias,
// sugestões encaixadas nos dias vazios/com folga, trechos entre paradas e o mapa (?vista=mapa).
// A página de cada parada fica em /roteiro/[stopId] (Parada.tsx).
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivitySheet, AddStopSheet, ChooseDaySheet, EditStopSheet, TransportSheet } from '../components/route/RouteSheets';
import { Badge, EstimateBadge } from '../components/ui/Badge';
import { Button, IconButton } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { useAction } from '../components/ui/feedback';
import type { IconName } from '../components/ui/icons.data';
import { ListRow } from '../components/ui/ListRow';
import { Photo, type PhotoData } from '../components/ui/Photo';
import { Icon } from '../components/ui/primitives';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { Segmented } from '../components/ui/Segmented';
import { Sheet } from '../components/ui/Sheet';
import { ScreenSkeleton } from '../components/ui/Skeleton';
import { acceptSuggestion, voteSuggestions } from '../data/suggestionActions';
import { useBundle } from '../data/TripContext';
import type { Activity, Stop, Suggestion, Transport, TransportMode, TripBundle } from '../data/types';
import { sortedStops, stopNights, straightKm } from '../lib/derive';
import { activityCapForStop } from '../lib/explore';
import { dateSpan, hhmm } from '../lib/format';
import { formatMoney } from '../lib/money';
import { dayPending, focusStopId, legInto, placeDaySuggestions, returnLeg, stopBadge, waitingCount, type Leg } from '../lib/route';
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
  const mapNote = (
    <p className={s.mapNote}>
      A linha liga as paradas em ordem e não é o trajeto real.
      {km.km > 0 ? ` ${km.km.toLocaleString('pt-BR')} km em linha reta${km.complete ? '' : ' (só entre paradas com coordenadas)'}.` : ''}
      {stops.some((x) => x.lat == null) ? ' Paradas sem coordenadas não aparecem: edite a parada e escolha o lugar na busca.' : ''}
    </p>
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
          <RouteMap stops={stops} accent={accent} height="calc(100dvh - 300px)" onOpen={openStop} focusId={focus} />
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

          <div className={s.layout}>
            <div className={s.list}>
              {stops.map((st, i) => {
                const leg = legInto(b, stops, i);
                return (
                  <div key={st.id} className={s.block} ref={(el) => { if (el) refs.current.set(st.id, el); else refs.current.delete(st.id); }}>
                    {leg ? <LegLine leg={leg} onEdit={canEdit ? () => setOpen({ kind: 'transport', stop: st }) : undefined} /> : null}
                    {st.id === focus ? (
                      <StopFocus b={b} stop={st} base={base} canEdit={canEdit} setOpen={setOpen} />
                    ) : (
                      <StopCompact b={b} stop={st} onFocus={() => setFocus(st.id)} onMenu={canEdit ? () => setOpen({ kind: 'menu', stop: st }) : undefined} />
                    )}
                  </div>
                );
              })}
              {(() => {
                const ret = returnLeg(b, stops);
                return ret?.transport ? <div className={s.block}><LegLine leg={ret} onEdit={canEdit ? () => setOpen({ kind: 'return', stop: stops[stops.length - 1], t: ret.transport! }) : undefined} /></div> : null;
              })()}
            </div>
            {wide ? (
              <aside className={s.aside} aria-label="Mapa da trilha">
                <RouteMap stops={stops} accent={accent} height="min(70vh, 640px)" onOpen={openStop} focusId={focus} />
                {mapNote}
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

/** Linha entre paradas: "Voo Lima → Cusco · 1h20 · R$ 520 / pessoa" e o selo "não reservado". */
function LegLine({ leg, onEdit }: { leg: Leg; onEdit?: () => void }) {
  const body = (
    <>
      <Icon name={MODE_ICON[leg.mode]} size={18} className={s.legIcon} />
      <span className={s.legText}>
        {leg.title}
        {leg.duration ? ` · ${leg.duration}` : ''}
        {leg.priceCents != null ? <> · <b className="num">{formatMoney(leg.priceCents, leg.currency, { compact: true })} / pessoa</b></> : null}
      </span>
      {leg.priceCents != null && leg.estimate ? <EstimateBadge /> : null}
      {leg.notBooked ? <Badge tone="warn">não reservado</Badge> : null}
      {!leg.transport && onEdit ? <Badge tone="neutral">definir trecho</Badge> : null}
    </>
  );
  return onEdit ? (
    <button type="button" className={s.leg} onClick={onEdit} aria-label={`Trecho: ${leg.title}. Editar`}>{body}</button>
  ) : (
    <div className={s.leg}>{body}</div>
  );
}

/** Parada fora de foco: linha compacta com miniatura, "datas · noites · bairro" e selo. */
function StopCompact({ b, stop, onFocus, onMenu }: { b: TripBundle; stop: Stop; onFocus: () => void; onMenu?: () => void }) {
  const badge = stopBadge(b, stop);
  return (
    <article className={s.compact} aria-label={`Parada ${stop.name}`}>
      <button type="button" className={s.compactMain} onClick={onFocus} aria-expanded={false}>
        <Photo photo={stop.photo?.url ? (stop.photo as PhotoData) : null} place={stop.name} alt="" height={52} radius="14px" caption={false} className={s.compactThumb} />
        <span className={s.compactText}>
          <span className={s.compactName}>{stop.name}</span>
          <span className={s.compactSub}>{[dateSpan(stop.arrival_date, stop.departure_date), stopNights(stop), stop.stay_base?.name ? `dorme em ${stop.stay_base.name}` : stop.area].filter(Boolean).join(' · ')}</span>
        </span>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </button>
      {onMenu ? <IconButton icon="more" label={`Mais ações de ${stop.name}`} variant="ghost" onClick={onMenu} /> : null}
    </article>
  );
}

/** Parada em foco: capa (leva à página da parada) e os dias com atividades e sugestões. */
function StopFocus({ b, stop, base, canEdit, setOpen }: { b: TripBundle; stop: Stop; base: string; canEdit: boolean; setOpen: (o: Open) => void }) {
  const slots = stopSlots(b, stop);
  const placed = useMemo(() => placeDaySuggestions(b, stop, activityCapForStop(b, stop)), [b, stop]);
  return (
    <article className={s.focus} aria-label={`Parada ${stop.name}`}>
      <Link href={`${base}/roteiro/${stop.id}`} className={s.cover} aria-label={`Ver a cidade: ${stop.name}${stop.area ? `, fiquem em ${stop.area}` : ''}`}>
        <Photo photo={stop.photo?.url ? (stop.photo as PhotoData) : null} place={stop.name} height="100%" radius="0" overlay>
          <div className={s.coverBase}>
            <span className={s.coverLine}>{dateSpan(stop.arrival_date, stop.departure_date)} · {stopNights(stop)}</span>
            <h2 className={s.coverName}>{stop.name}</h2>
            <span className={s.coverChips}>
              {stop.stay_base?.name ? <span className={s.chipLight}>Dormem em {stop.stay_base.name}</span> : stop.area ? <span className={s.chipLight}>Fiquem em {stop.area}</span> : null}
              <span className={s.chipDark}>Ver a cidade →</span>
            </span>
          </div>
        </Photo>
      </Link>
      {canEdit ? (
        <div className={s.focusTools}>
          <Button size="sm" variant="secondary" icon="edit" onClick={() => setOpen({ kind: 'edit', stop })}>Editar parada</Button>
          <IconButton icon="more" label={`Mais ações de ${stop.name}`} variant="ghost" onClick={() => setOpen({ kind: 'menu', stop })} />
        </div>
      ) : null}
      <div className={s.days}>
        {slots.map((slot) => (
          <DayRow key={slot.date} b={b} stop={stop} slot={slot} suggestions={placed.get(slot.date) ?? []} canEdit={canEdit} setOpen={setOpen} />
        ))}
        {canEdit ? <Button variant="dashed" size="sm" icon="plus" block onClick={() => setOpen({ kind: 'act', stop, act: null })} className={s.addAct}>Atividade</Button> : null}
      </div>
    </article>
  );
}

function DayRow({ b, stop, slot, suggestions, canEdit, setOpen }: { b: TripBundle; stop: Stop; slot: DaySlot; suggestions: Suggestion[]; canEdit: boolean; setOpen: (o: Open) => void }) {
  const { source, reload, me } = useBundle();
  const { run, busy } = useAction();
  const acts = b.activities.filter((a) => a.stop_id === stop.id && a.day === slot.date).sort((x, y) => (x.time ?? '99').localeCompare(y.time ?? '99') || x.position - y.position);
  const pending = dayPending(b, stop, slot.date);
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

  return (
    <div className={s.day}>
      <div className={s.dayNum} aria-hidden="true"><small>DIA</small>{slot.dayNumber}</div>
      <div className={s.dayBody}>
        <span className="sr">Dia {slot.dayNumber}</span>
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
        {empty && slot.state === 'vazio' ? <span className={`${s.actTitle} ${s.muted}`}>Dia vazio</span> : null}

        {suggestions.length === 1 || (suggestions.length && slot.state === 'folga') ? (
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

        {pending.map((p) => <span key={p} className={s.pending}>{p}</span>)}
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
  const cost = p.cost_high != null ? (p.cost_high > 0 ? `≈ ${formatMoney(Math.round(((p.cost_low ?? p.cost_high) + p.cost_high) / 2), p.currency ?? 'BRL', { compact: true })}/pessoa` : 'grátis') : null;
  return (
    <div className={s.inline}>
      <Photo photo={p.photo?.url ? (p.photo as PhotoData) : null} place={p.photo_query ?? p.title} alt="" height={56} radius="12px" caption={false} className={s.inlineThumb} />
      <span className={s.inlineText}>
        <span className={s.inlineReason}>Sugestão · {free ?? fitLabel(sg)}</span>
        <b>{p.title}</b>
        <span className={s.inlineMeta}>{[p.duration, cost].filter(Boolean).join(' · ')}{p.cost_high ? <> <EstimateBadge /></> : null}</span>
      </span>
      {canEdit ? (
        <button type="button" className={s.plus} onClick={onAdd} disabled={busy} aria-label={`Adicionar ${p.title} ao dia ${slot.dayNumber}`}>
          <Icon name="plus" size={20} />
        </button>
      ) : null}
    </div>
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
