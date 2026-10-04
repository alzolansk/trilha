'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PlaceSearch, type Place } from '../components/forms/PlaceSearch';
import { useDraft } from '../components/forms/useDraft';
import { Dialog, useAction, useConfirm, useToast } from '../components/ui/feedback';
import { AiNote, Floaters, Icon, PageTitle, Pattern, useReveal } from '../components/ui/primitives';
import { useBundle } from '../data/TripContext';
import type { Activity, Stay, Stop, Transport, TransportMode } from '../data/types';
import { callAi } from '../lib/ai/client';
import {
  arrivalOf, docsOfStop, durationLabel, legToNext, sortedStops, stayOf, stayStatusLabel, stopCode, stopDates, stopMeta,
  stopNights, straightKm, ticketTimes, transportMinutes, tripPhase, tripTarget,
} from '../lib/derive';
import { dateRange, daysBetween, isValidTimeZone, listTimeZones } from '../lib/time';
import { dayWeekU, hhmm, MODE_LABEL, MODE_SHORT } from '../lib/format';
import { fgOn } from '../lib/identity/contrast';
import { colorCycle } from '../lib/identity/theme';
import { ruleTip } from '../lib/rules';
import { countdown } from '../lib/time';
import s from './roteiro.module.css';

const RouteMap = dynamic(() => import('../components/map/RouteMap'), { ssr: false, loading: () => <div className="skel" style={{ height: 420 }} /> });

const MODES: TransportMode[] = ['bus', 'plane', 'train', 'car', 'boat', 'walk', 'other'];
const nn = (v: string) => (v.trim() === '' ? null : v.trim());

function useStopsState() {
  const ctx = useBundle();
  const stops = useMemo(() => sortedStops(ctx.bundle), [ctx.bundle]);
  return { ...ctx, stops };
}

export default function Roteiro() {
  const { bundle: b, identity, canEdit, stops } = useStopsState();
  const params = useSearchParams();
  const router = useRouter();
  const cols = colorCycle(identity);
  const [mapOpen, setMapOpen] = useState(false);
  const sel = Math.max(0, stops.findIndex((x) => x.id === params.get('parada')));
  const detailRef = useRef<HTMLElement>(null);
  useReveal([stops.length]);

  const select = (i: number) => {
    const q = new URLSearchParams(params.toString());
    q.set('parada', stops[i].id);
    router.replace(`?${q.toString()}`, { scroll: false });
    if (window.innerWidth < 900) setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const phase = tripPhase(b.trip);
  const days = countdown(Date.now(), tripTarget(b.trip), b.trip.departure_tz).totalDays;
  const eyebrow = `${b.trip.title} · ${phase.kind === 'before' ? `faltam ${days} dias` : phase.kind === 'after' ? 'viagem concluída' : 'em andamento'}`;
  const totalDays = daysBetween(b.trip.start_date, b.trip.end_date) + 1;
  const km = straightKm(stops);

  return (
    <div className="wrap">
      <Floaters />
      <PageTitle
        eyebrow={eyebrow}
        title="Roteiro"
        sub={stops.length ? `${stops.length} ${stops.length === 1 ? 'parada' : 'paradas'}, ${totalDays} dias, uma linha. Toque numa parada pra ver tudo dela.` : 'Nenhuma parada ainda. Comece pela primeira cidade.'}
        actions={
          <>
            <button className="btn tap lift" onClick={() => setMapOpen(true)} disabled={!stops.length}>
              <Icon name="map" size={18} />
              Ver no mapa
            </button>
            {canEdit ? (
              <a className="btn btn-primary tap lift" href="#nova">
                <Icon name="plus" size={18} />
                Adicionar parada
              </a>
            ) : null}
          </>
        }
      />

      {stops.length ? (
        <div className={s.segbar} role="group" aria-label="Paradas">
          {stops.map((st, i) => {
            const c = cols[i % 4];
            return (
              <button key={st.id} className="tap" aria-pressed={i === sel} onClick={() => select(i)} style={{ flex: `${Math.max(1, daysBetween(st.arrival_date, st.departure_date))} 1 0`, background: c, color: fgOn(c) }}>
                <b>{stopCode(st)}</b>
                <span>{stopNights(st)}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      <section className="split">
        <div className="col-side">
          {stops.map((st, i) => {
            const c = cols[i % 4];
            const leg = legToNext(b, stops, i);
            return (
              <div key={st.id} className="rv">
                <div className={s.stopRow}>
                  <button className={`${s.stopBtn} lift tap`} aria-pressed={i === sel} onClick={() => select(i)}>
                    <span className="num">
                      <i style={{ background: c }} />
                      <b style={{ color: fgOn(c) }}>{i + 1}</b>
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="disp" style={{ display: 'block', fontSize: 24, lineHeight: 1.05, letterSpacing: '-.01em' }}>{st.name}</span>
                      <span className="mono" style={{ display: 'block', fontSize: 12, marginTop: 4, opacity: 0.8 }}>
                        {stopDates(st)} · {stopNights(st)}
                      </span>
                    </span>
                  </button>
                  {canEdit ? <Reorder stops={stops} i={i} /> : null}
                </div>
                {leg ? (
                  <div className={s.leg}>
                    <svg aria-hidden="true" width="4" height="44" viewBox="0 0 4 44">
                      <path className="dm" d="M2 0 V44" stroke="currentColor" strokeWidth="2.5" strokeOpacity=".5" />
                    </svg>
                    <span>{leg}</span>
                  </div>
                ) : i < stops.length - 1 ? <div style={{ height: 12 }} /> : null}
              </div>
            );
          })}
          {canEdit ? <NewStopForm stops={stops} onCreated={(id) => router.replace(`?parada=${id}`, { scroll: false })} /> : null}
          {!canEdit && !stops.length ? <div className="empty"><h3 className="disp">Roteiro vazio</h3><p style={{ margin: 0 }}>Quem organiza ainda não adicionou paradas.</p></div> : null}
        </div>
        {stops.length ? <StopDetail key={stops[sel].id} stop={stops[sel]} index={sel} total={stops.length} color={cols[sel % 4]} refEl={detailRef} /> : null}
      </section>

      <Dialog open={mapOpen} onClose={() => setMapOpen(false)} title="Mapa da trilha">
        {mapOpen ? <RouteMap stops={stops} colors={cols} line={identity.palette.acc} /> : null}
        <p className="mono" style={{ margin: 0, fontSize: 12, color: 'var(--mute)' }}>
          A LINHA LIGA AS PARADAS EM ORDEM E NÃO É O TRAJETO REAL.{' '}
          {km.km > 0 ? `${km.km.toLocaleString('pt-BR')} KM EM LINHA RETA${km.complete ? '' : ' (SÓ ENTRE PARADAS COM COORDENADAS)'}.` : ''}
          {stops.some((x) => x.lat == null) ? ' PARADAS SEM COORDENADAS NÃO APARECEM: EDITE A PARADA E ESCOLHA O LUGAR NA BUSCA.' : ''}
        </p>
      </Dialog>
    </div>
  );
}

function Reorder({ stops, i }: { stops: Stop[]; i: number }) {
  const { source, reload } = useBundle();
  const { run, busy } = useAction();
  const move = (d: -1 | 1) =>
    run(async () => {
      const a = stops[i];
      const c = stops[i + d];
      await source.update('stops', a.id, { position: c.position === a.position ? a.position + d : c.position }, a.version);
      await source.update('stops', c.id, { position: a.position }, c.version);
      await reload();
    });
  return (
    <div className={s.reorder}>
      <button aria-label={`Mover ${stops[i].name} para cima`} disabled={busy || i === 0} onClick={() => move(-1)}>↑</button>
      <button aria-label={`Mover ${stops[i].name} para baixo`} disabled={busy || i === stops.length - 1} onClick={() => move(1)}>↓</button>
    </div>
  );
}

function NewStopForm({ stops, onCreated }: { stops: Stop[]; onCreated: (id: string) => void }) {
  const { bundle: b, source, reload } = useBundle();
  const { run, busy } = useAction();
  const last = stops.at(-1);
  const d = useDraft(`stop-new-${b.trip.id}`, { name: '', a: last?.departure_date ?? b.trip.start_date, b: last?.departure_date ?? b.trip.start_date, mode: 'bus' as TransportMode, country: '', lat: '', lng: '', alt: '' });
  const v = d.value;
  const valid = v.name.trim() && v.a && v.b && v.b >= v.a;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    void run(async () => {
      const pos = (last?.position ?? -1) + 1;
      const stop = await source.insert<Stop>('stops', {
        trip_id: b.trip.id, position: pos, name: v.name.trim(), country: nn(v.country), arrival_date: v.a, departure_date: v.b,
        arrival_mode: v.mode, lat: v.lat ? Number(v.lat) : null, lng: v.lng ? Number(v.lng) : null, altitude_m: v.alt ? Number(v.alt) : null,
      });
      await source.insert('transports', { trip_id: b.trip.id, stop_id: stop.id, mode: v.mode, origin_name: last?.name ?? b.trip.origin ?? null, origin_code: last?.code ?? (last ? null : b.trip.origin), dest_name: stop.name, depart_date: v.a });
      d.clear();
      d.setValue({ name: '', a: v.b, b: v.b, mode: 'bus', country: '', lat: '', lng: '', alt: '' });
      await reload();
      onCreated(stop.id);
      // Dica da IA assíncrona: se falhar, nada aparece (nunca bloqueia).
      if (source.kind === 'supabase') {
        void callAi('tips', { tripId: b.trip.id, stopId: stop.id }).then((r) => r && reload());
      }
    }, { success: `${v.name.trim()} entrou no roteiro.` });
  };

  return (
    <form id="nova" className={`${s.newStop} rv`} onSubmit={submit} aria-label="Nova parada">
      <h2 className="disp" style={{ margin: 0, fontSize: 24 }}>Nova parada</h2>
      {d.restored && v.name ? <span className="pill">RASCUNHO RECUPERADO</span> : null}
      <PlaceSearch
        label="Cidade ou lugar"
        value={v.name}
        required
        placeholder="Digite um lugar"
        enabled={source.kind === 'supabase'}
        onText={(t) => d.setValue({ ...v, name: t, lat: '', lng: '' })}
        onPick={(p: Place) => d.setValue({ ...v, name: p.name, country: p.country ?? v.country, lat: String(p.lat), lng: String(p.lng), alt: p.altitude != null ? String(p.altitude) : '' })}
      />
      <div className="grid2">
        <label className="field">Chegada<input type="date" required value={v.a} min={b.trip.start_date} max={b.trip.end_date} onChange={(e) => d.set('a', e.target.value)} /></label>
        <label className="field">Saída<input type="date" required value={v.b} min={v.a} onChange={(e) => d.set('b', e.target.value)} /></label>
      </div>
      {v.b < v.a ? <span className="field"><span className="err">A saída precisa ser no dia da chegada ou depois.</span></span> : null}
      <label className="field">Como você chega
        <select value={v.mode} onChange={(e) => d.set('mode', e.target.value as TransportMode)}>
          {MODES.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
        </select>
      </label>
      {v.lat ? <span className="hint mono" style={{ fontSize: 11 }}>{v.country ? `${v.country} · ` : ''}COORDENADAS {Number(v.lat).toFixed(3)}, {Number(v.lng).toFixed(3)}{v.alt ? ` · ALTITUDE ${v.alt} M (OSM)` : ''}</span> : null}
      <button className="btn btn-ink tap" style={{ justifyContent: 'center' }} disabled={busy || !valid}>
        {busy ? 'Salvando…' : 'Salvar parada'}
      </button>
    </form>
  );
}

function Weather({ stop }: { stop: Stop }) {
  const [data, setData] = useState<{ days: { d: string; max: number; min: number; rain: number | null }[] } | null>(null);
  useEffect(() => {
    if (stop.lat == null || stop.lng == null) return;
    const today = new Date().toISOString().slice(0, 10);
    const limit = new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10);
    if (stop.departure_date < today || stop.arrival_date > limit) return;
    const start = stop.arrival_date < today ? today : stop.arrival_date;
    const end = stop.departure_date > limit ? limit : stop.departure_date;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${stop.lat}&longitude=${stop.lng}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&start_date=${start}&end_date=${end}`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j?.daily) return;
        setData({ days: j.daily.time.map((d: string, i: number) => ({ d, max: Math.round(j.daily.temperature_2m_max[i]), min: Math.round(j.daily.temperature_2m_min[i]), rain: j.daily.precipitation_probability_max?.[i] ?? null })) });
      })
      .catch(() => undefined);
  }, [stop.lat, stop.lng, stop.arrival_date, stop.departure_date]);
  if (!data?.days.length) return null;
  return (
    <div>
      <h3 className="h3"><Icon name="sun" size={18} />Previsão do tempo</h3>
      <div className={s.weather}>
        {data.days.map((x) => (
          <div key={x.d}>
            <b>{dayWeekU(x.d)}</b>
            <span>{x.min}° / {x.max}°</span>
            {x.rain != null ? <span>chuva {x.rain}%</span> : null}
          </div>
        ))}
      </div>
      <p className="mono" style={{ margin: '6px 0 0', fontSize: 10, color: 'var(--mute)' }}>PREVISÃO OPEN-METEO.COM (CC BY 4.0) · ATUALIZA AO ABRIR</p>
    </div>
  );
}

function StopDetail({ stop, index, total, color, refEl }: { stop: Stop; index: number; total: number; color: string; refEl: React.RefObject<HTMLElement | null> }) {
  const { bundle: b, identity, canEdit, source, reload, base } = useBundle();
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const toast = useToast();
  const router = useRouter();
  const t = arrivalOf(b, stop.id);
  const stay = stayOf(b, stop.id);
  const docs = docsOfStop(b, stop.id);
  const status = stayStatusLabel(b, stay);
  const acts = b.activities.filter((a) => a.stop_id === stop.id).sort((x, y) => x.day.localeCompare(y.day) || x.position - y.position);
  const tip = stop.tip ?? (ruleTip(b, stop) ? { ...ruleTip(b, stop)!, by: 'rules' as const, source: undefined } : null);
  const [edit, setEdit] = useState<null | 'stop' | 'transport' | 'stay' | { act: Activity | null }>(null);
  const [notes, setNotes] = useState(stop.notes ?? '');
  const [tipBusy, setTipBusy] = useState(false);
  const times = ticketTimes(t);
  const fg = fgOn(color);

  const saveNotes = () => {
    if ((stop.notes ?? '') === notes) return;
    void run(() => source.update('stops', stop.id, { notes: nn(notes) }, stop.version).then(reload), {
      success: 'Notas salvas.',
      onConflict: () => source.update('stops', stop.id, { notes: nn(notes) }).then(reload),
    });
  };

  const removeStop = async () => {
    const ok = await confirm({ title: `Excluir ${stop.name}?`, message: 'A parada sai do roteiro junto com trecho, hospedagem e plano. Documentos ligados continuam no hub, só perdem o vínculo.' });
    if (!ok) return;
    await run(async () => {
      await source.remove('stops', { id: stop.id });
      await reload();
      router.replace('?', { scroll: false });
    }, { success: `${stop.name} saiu do roteiro.` });
  };

  const askTip = async () => {
    setTipBusy(true);
    const r = await callAi('tips', { tripId: b.trip.id, stopId: stop.id });
    setTipBusy(false);
    if (r) await reload();
    else toast('A IA não respondeu agora. Tente mais tarde; o resto funciona normal.');
  };

  return (
    <article className={`${s.detail} card col-main`} ref={refEl as React.RefObject<HTMLElement>} aria-label={`Parada ${stop.name}`}>
      <div className={s.detailHead} style={{ background: color, color: fg }}>
        <Pattern identity={identity} opacity={0.18} />
        <div aria-hidden="true" style={{ position: 'absolute', right: -40, top: -50, width: 220, height: 220, clipPath: 'var(--motif)', background: 'var(--bg)', opacity: 0.35, animation: 'floaty 8s ease-in-out infinite' }} />
        <div className="mono" style={{ position: 'relative', fontSize: 12, letterSpacing: '.2em' }}>
          PARADA {index + 1} DE {total}{stop.country ? ` · ${stop.country.toUpperCase()}` : ''}
        </div>
        <h2 className="disp">{stop.name}</h2>
        <div className="mono" style={{ position: 'relative', display: 'flex', flexWrap: 'wrap', gap: '8px 22px', marginTop: 16, fontSize: 14 }}>
          <span>{stopDates(stop)}</span>
          <span>{stopNights(stop)}</span>
          {stopMeta(stop) ? <span>{stopMeta(stop)}</span> : null}
          {stop.tz ? <span>FUSO {stop.tz}</span> : null}
        </div>
        {canEdit ? (
          <div style={{ position: 'relative', display: 'flex', gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
            <button className="btn btn-sm tap" onClick={() => setEdit('stop')}><Icon name="edit" size={16} />Editar parada</button>
            <button className="btn btn-sm btn-danger tap" style={{ background: 'var(--card)' }} onClick={removeStop} disabled={busy}>Excluir</button>
          </div>
        ) : null}
      </div>
      <div className={s.detailBody}>
        {tip ? (
          <AiNote by={tip.by} source={'source' in tip && tip.source ? tip.source : null}>{tip.text}</AiNote>
        ) : canEdit && source.kind === 'supabase' ? (
          <button className="btn btn-sm btn-ghost tap" onClick={askTip} disabled={tipBusy} style={{ alignSelf: 'flex-start' }}>
            <Icon name="sparkle" size={14} fill="currentColor" />
            {tipBusy ? 'Pedindo dica…' : 'Pedir dica à IA'}
          </button>
        ) : null}

        <Weather stop={stop} />

        <div>
          <div className={s.secHead}>
            <h3 className="h3">Como chego</h3>
            {canEdit ? <button className="btn btn-sm tap" onClick={() => setEdit('transport')}><Icon name="edit" size={16} />{t ? 'Editar trecho' : 'Adicionar trecho'}</button> : null}
          </div>
          <div className={s.pass} style={{ marginTop: 12 }}>
            <span className="notch l" />
            <span className="notch r" />
            <div className={s.passMain}>
              <div>
                <div className={s.code}>{t?.origin_code || '[ORIGEM]'}</div>
                <div className="mono" style={{ fontSize: 14, marginTop: 6 }}>{times.dep}</div>
                {t?.origin_name ? <div style={{ fontSize: 13, color: 'var(--mute)' }}>{t.origin_name}</div> : null}
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 80 }}>
                <span className="mono" style={{ fontSize: 11, letterSpacing: '.14em', padding: '4px 10px', borderRadius: 999, background: 'var(--ink)', color: 'var(--bg)' }}>{MODE_SHORT[t?.mode ?? stop.arrival_mode ?? 'other']}</span>
                <svg aria-hidden="true" width="100%" height="10" preserveAspectRatio="none" viewBox="0 0 100 10">
                  <path className="dm" d="M0 5 H100" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                </svg>
                {t && transportMinutes(t) ? <span className="mono" style={{ fontSize: 11 }}>{durationLabel(transportMinutes(t))}</span> : null}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className={s.code}>{t?.dest_code || stopCode(stop)}</div>
                <div className="mono" style={{ fontSize: 14, marginTop: 6 }}>{times.arr}</div>
                {t?.dest_name ? <div style={{ fontSize: 13, color: 'var(--mute)' }}>{t.dest_name}</div> : null}
              </div>
            </div>
            <div className={`${s.passSide} mono`}>
              <span>LOC {t?.booking_ref || '[CÓDIGO]'}</span>
              <span>LUGAR {t?.seat || '[ASSENTO]'}</span>
              <span>{t?.depart_date ? stopDates({ ...stop, arrival_date: t.depart_date, departure_date: t.arrive_date ?? t.depart_date }) : '[DATA]'}</span>
            </div>
          </div>
          {!t?.dest_code && !stop.code ? <p className="mono" style={{ margin: '6px 0 0', fontSize: 10, color: 'var(--mute)' }}>CÓDIGO {stopCode(stop)} DERIVADO DO NOME · INFORME O IATA/ABREVIAÇÃO AO EDITAR</p> : null}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(240px,100%),1fr))', gap: 18 }}>
          <div className={`${s.box} lift`}>
            <h3 className="h3"><Icon name="bed" size={18} />Onde durmo</h3>
            <div style={{ fontWeight: 600, fontSize: 18 }}>{stay?.name ?? 'Ainda sem hospedagem'}</div>
            {stay ? <div style={{ fontSize: 14, color: 'var(--mute)', marginTop: 4 }}>{[stay.checkin_time ? `Check-in ${hhmm(stay.checkin_time)}` : null, stay.address].filter(Boolean).join(' · ')}</div> : null}
            <span className="pill" data-tone={status.tone} style={{ marginTop: 12 }}>{status.label.toUpperCase()}</span>
            {stay?.suggested_by ? <span className="tag" data-src={stay.suggested_by} style={{ marginLeft: 8 }}>{stay.suggested_by === 'ai' ? 'SUGESTÃO IA' : 'AUTO'}</span> : null}
            {canEdit ? <div style={{ marginTop: 12 }}><button className="btn btn-sm tap" onClick={() => setEdit('stay')}>{stay ? 'Editar' : 'Adicionar'}</button></div> : null}
          </div>
          <div className={`${s.box} lift`}>
            <h3 className="h3"><Icon name="doc" size={18} />Documentos</h3>
            {docs.length ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {docs.map((d) => (
                  <Link key={d.id} href={`${base}/documentos?doc=${d.id}`} style={{ fontSize: 14, padding: '8px 12px', borderRadius: 12, background: 'var(--bg)', border: '1px solid var(--line)', textDecoration: 'none' }}>{d.title}</Link>
                ))}
              </div>
            ) : (
              <Link href={`${base}/documentos?parada=${stop.id}`}>Anexar um documento</Link>
            )}
          </div>
        </div>

        <div>
          <div className={s.secHead}>
            <h3 className="h3">Plano</h3>
            {canEdit ? <button className="btn btn-sm tap" onClick={() => setEdit({ act: null })}><Icon name="plus" size={16} />Atividade</button> : null}
          </div>
          {acts.length ? (
            <ol className={s.plan} style={{ marginTop: 12 }}>
              {acts.map((a) => (
                <li key={a.id}>
                  <i className="bullet" style={{ background: color }} />
                  <span className="mono" style={{ fontSize: 12, minWidth: 56 }}>{dayWeekU(a.day)}{a.time ? ` ${hhmm(a.time)}` : ''}</span>
                  <span style={{ flex: 1 }}>{a.title}{a.notes ? <span style={{ display: 'block', fontSize: 13, color: 'var(--mute)' }}>{a.notes}</span> : null}</span>
                  {a.suggested_by ? <span className="tag" data-src={a.suggested_by}>{a.suggested_by === 'ai' ? 'IA' : 'AUTO'}</span> : null}
                  {canEdit ? <button className="btn btn-icon btn-sm tap" aria-label={`Editar ${a.title}`} onClick={() => setEdit({ act: a })}><Icon name="edit" size={16} /></button> : null}
                </li>
              ))}
            </ol>
          ) : (
            <p style={{ margin: '12px 0 0', color: 'var(--mute)' }}>Nenhuma atividade planejada.</p>
          )}
        </div>

        <label className="field">
          <span className="h3" style={{ margin: 0 }}>Notas</span>
          <textarea rows={3} placeholder={canEdit ? 'Anote o que quiser sobre esta parada' : 'Sem notas'} value={notes} readOnly={!canEdit} onChange={(e) => setNotes(e.target.value)} onBlur={saveNotes} maxLength={4000} />
        </label>
      </div>

      {edit === 'stop' ? <StopEditDialog stop={stop} onClose={() => setEdit(null)} /> : null}
      {edit === 'transport' ? <TransportDialog stop={stop} t={t} onClose={() => setEdit(null)} /> : null}
      {edit === 'stay' ? <StayDialog stop={stop} stay={stay} onClose={() => setEdit(null)} /> : null}
      {edit && typeof edit === 'object' ? <ActivityDialog stop={stop} act={edit.act} onClose={() => setEdit(null)} /> : null}
    </article>
  );
}

function StopEditDialog({ stop, onClose }: { stop: Stop; onClose: () => void }) {
  const { source, reload, bundle: b } = useBundle();
  const { run, busy } = useAction();
  const [v, setV] = useState({
    name: stop.name, country: stop.country ?? '', code: stop.code ?? '', a: stop.arrival_date, b: stop.departure_date, tz: stop.tz ?? '',
    alt: stop.altitude_m != null ? String(stop.altitude_m) : '', lat: stop.lat != null ? String(stop.lat) : '', lng: stop.lng != null ? String(stop.lng) : '',
    mode: stop.arrival_mode ?? 'bus', meta: stop.meta ?? '',
  });
  const tzs = useMemo(() => listTimeZones(), []);
  const codeOk = !v.code || /^[A-Za-z0-9]{2,4}$/.test(v.code);
  const tzOk = !v.tz || isValidTimeZone(v.tz);
  const ok = v.name.trim() && v.b >= v.a && codeOk && tzOk && (!v.lat === !v.lng);
  const patch = () => ({
    name: v.name.trim(), country: nn(v.country), code: v.code ? v.code.toUpperCase() : null, arrival_date: v.a, departure_date: v.b, tz: nn(v.tz),
    altitude_m: v.alt ? Math.round(Number(v.alt)) : null, lat: v.lat ? Number(v.lat) : null, lng: v.lng ? Number(v.lng) : null, arrival_mode: v.mode, meta: nn(v.meta),
  });
  const save = () =>
    run(() => source.update('stops', stop.id, patch(), stop.version).then(reload).then(onClose), {
      success: 'Parada atualizada.',
      onConflict: () => source.update('stops', stop.id, patch()).then(reload).then(onClose),
    });
  return (
    <Dialog open onClose={onClose} title="Editar parada" footer={<><button className="btn tap" onClick={onClose}>Cancelar</button><button className="btn btn-primary tap" disabled={!ok || busy} onClick={save}>Salvar</button></>}>
      <PlaceSearch label="Cidade ou lugar" value={v.name} enabled={source.kind === 'supabase'} onText={(t) => setV({ ...v, name: t })} onPick={(p) => setV({ ...v, name: p.name, country: p.country ?? v.country, lat: String(p.lat), lng: String(p.lng), alt: p.altitude != null ? String(p.altitude) : v.alt })} />
      <div className="grid2">
        <label className="field">País<input value={v.country} maxLength={60} onChange={(e) => setV({ ...v, country: e.target.value })} /></label>
        <label className="field">Código (IATA ou abreviação)<input value={v.code} maxLength={4} onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase() })} placeholder="CUZ" />{!codeOk ? <span className="err">2 a 4 letras ou números.</span> : null}</label>
        <label className="field">Chegada<input type="date" value={v.a} onChange={(e) => setV({ ...v, a: e.target.value })} /></label>
        <label className="field">Saída<input type="date" value={v.b} min={v.a} onChange={(e) => setV({ ...v, b: e.target.value })} /></label>
        <label className="field">Fuso horário<input list="tzlist" value={v.tz} onChange={(e) => setV({ ...v, tz: e.target.value })} placeholder={b.trip.home_tz} />{!tzOk ? <span className="err">Fuso desconhecido (ex.: America/Lima).</span> : null}</label>
        <label className="field">Altitude (m)<input type="number" value={v.alt} min={-500} max={9000} onChange={(e) => setV({ ...v, alt: e.target.value })} placeholder="só se souber" /></label>
        <label className="field">Como chega<select value={v.mode} onChange={(e) => setV({ ...v, mode: e.target.value as TransportMode })}>{MODES.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}</select></label>
        <label className="field">Linha curta<input value={v.meta} maxLength={80} onChange={(e) => setV({ ...v, meta: e.target.value })} placeholder="medina e souks" /></label>
      </div>
      <datalist id="tzlist">{tzs.map((z) => <option key={z} value={z} />)}</datalist>
      <span className="hint mono" style={{ fontSize: 11, color: 'var(--mute)' }}>{v.lat ? `COORDENADAS ${Number(v.lat).toFixed(4)}, ${Number(v.lng).toFixed(4)}` : 'SEM COORDENADAS: ESCOLHA O LUGAR NA BUSCA PARA APARECER NO MAPA'}{v.lat ? <button type="button" className="btn btn-sm" style={{ marginLeft: 8, minHeight: 30 }} onClick={() => setV({ ...v, lat: '', lng: '' })}>Remover</button> : null}</span>
    </Dialog>
  );
}

function TransportDialog({ stop, t, onClose }: { stop: Stop; t: Transport | null; onClose: () => void }) {
  const { source, reload, bundle: b } = useBundle();
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const passDocs = b.documents.filter((d) => d.category === 'passagem' && d.status === 'ready');
  const [v, setV] = useState({
    mode: t?.mode ?? stop.arrival_mode ?? 'bus', origin_code: t?.origin_code ?? '', origin_name: t?.origin_name ?? '', dest_code: t?.dest_code ?? stop.code ?? '', dest_name: t?.dest_name ?? stop.name,
    depart_date: t?.depart_date ?? stop.arrival_date, depart_time: hhmm(t?.depart_time), depart_tz: t?.depart_tz ?? '', arrive_date: t?.arrive_date ?? stop.arrival_date, arrive_time: hhmm(t?.arrive_time),
    arrive_tz: t?.arrive_tz ?? stop.tz ?? '', booking_ref: t?.booking_ref ?? '', seat: t?.seat ?? '', duration: t?.duration_min ? String(t.duration_min) : '', document_id: t?.document_id ?? '', notes: t?.notes ?? '',
  });
  const okTz = (!v.depart_tz || isValidTimeZone(v.depart_tz)) && (!v.arrive_tz || isValidTimeZone(v.arrive_tz));
  const row = () => ({
    mode: v.mode, origin_code: nn(v.origin_code.toUpperCase()), origin_name: nn(v.origin_name), dest_code: nn(v.dest_code.toUpperCase()), dest_name: nn(v.dest_name),
    depart_date: nn(v.depart_date), depart_time: nn(v.depart_time), depart_tz: nn(v.depart_tz), arrive_date: nn(v.arrive_date), arrive_time: nn(v.arrive_time), arrive_tz: nn(v.arrive_tz),
    booking_ref: nn(v.booking_ref), seat: nn(v.seat), duration_min: v.duration ? Number(v.duration) : null, document_id: nn(v.document_id), notes: nn(v.notes),
  });
  const save = () =>
    run(async () => {
      if (t) await source.update('transports', t.id, row(), t.version);
      else await source.insert('transports', { ...row(), trip_id: b.trip.id, stop_id: stop.id });
      await reload();
      onClose();
    }, { success: 'Trecho salvo.', onConflict: async () => { if (t) await source.update('transports', t.id, row()); await reload(); onClose(); } });
  const del = async () => {
    if (!t || !(await confirm({ title: 'Excluir trecho?', message: 'Os dados do bilhete deste trecho serão apagados.' }))) return;
    await run(() => source.remove('transports', { id: t.id }).then(reload).then(onClose), { success: 'Trecho excluído.' });
  };
  const f = (k: keyof typeof v, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="field">{label}<input value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} {...extra} /></label>
  );
  return (
    <Dialog open onClose={onClose} title={`Como chego em ${stop.name}`} footer={<>{t ? <button className="btn btn-danger tap" onClick={del}>Excluir</button> : null}<button className="btn tap" onClick={onClose}>Cancelar</button><button className="btn btn-primary tap" disabled={busy || !okTz} onClick={save}>Salvar</button></>}>
      <label className="field">Meio de transporte<select value={v.mode} onChange={(e) => setV({ ...v, mode: e.target.value as TransportMode })}>{MODES.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}</select></label>
      <div className="grid2">
        {f('origin_code', 'Origem (código)', { maxLength: 8, placeholder: 'GRU' })}
        {f('origin_name', 'Origem (nome)', { maxLength: 80 })}
        {f('dest_code', 'Destino (código)', { maxLength: 8 })}
        {f('dest_name', 'Destino (nome)', { maxLength: 80 })}
        {f('depart_date', 'Data de saída', { type: 'date' })}
        {f('depart_time', 'Horário de saída (local)', { type: 'time' })}
        {f('arrive_date', 'Data de chegada', { type: 'date' })}
        {f('arrive_time', 'Horário de chegada (local)', { type: 'time' })}
        {f('depart_tz', 'Fuso da saída', { list: 'tzlist2', placeholder: 'America/Sao_Paulo' })}
        {f('arrive_tz', 'Fuso da chegada', { list: 'tzlist2', placeholder: 'America/Lima' })}
        {f('booking_ref', 'Localizador', { maxLength: 40 })}
        {f('seat', 'Assento / poltrona', { maxLength: 40 })}
        {f('duration', 'Duração em minutos (se souber)', { type: 'number', min: 1, max: 10080 })}
        <label className="field">Passagem anexada<select value={v.document_id} onChange={(e) => setV({ ...v, document_id: e.target.value })}><option value="">Nenhuma</option>{passDocs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}</select></label>
      </div>
      <datalist id="tzlist2">{listTimeZones().map((z) => <option key={z} value={z} />)}</datalist>
      {!okTz ? <span className="field"><span className="err">Fuso desconhecido.</span></span> : null}
      <p className="hint" style={{ margin: 0, fontSize: 13, color: 'var(--mute)' }}>A duração só é calculada quando datas, horários e fusos das duas pontas estão preenchidos.</p>
    </Dialog>
  );
}

function StayDialog({ stop, stay, onClose }: { stop: Stop; stay: Stay | null; onClose: () => void }) {
  const { source, reload, bundle: b } = useBundle();
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const resDocs = b.documents.filter((d) => d.category === 'reserva' && d.status === 'ready');
  const [v, setV] = useState({
    name: stay?.name ?? '', address: stay?.address ?? '', checkin_date: stay?.checkin_date ?? stop.arrival_date, checkin_time: hhmm(stay?.checkin_time), checkout_date: stay?.checkout_date ?? stop.departure_date,
    checkout_time: hhmm(stay?.checkout_time), status: stay?.status ?? 'pending', notes: stay?.notes ?? '', document_id: stay?.document_id ?? '',
  });
  const row = () => ({ name: v.name.trim(), address: nn(v.address), checkin_date: nn(v.checkin_date), checkin_time: nn(v.checkin_time), checkout_date: nn(v.checkout_date), checkout_time: nn(v.checkout_time), status: v.status, notes: nn(v.notes), document_id: nn(v.document_id), suggested_by: null });
  const save = () =>
    run(async () => {
      if (stay) await source.update('stays', stay.id, row(), stay.version);
      else await source.insert('stays', { ...row(), trip_id: b.trip.id, stop_id: stop.id });
      await reload();
      onClose();
    }, { success: 'Hospedagem salva.', onConflict: async () => { if (stay) await source.update('stays', stay.id, row()); await reload(); onClose(); } });
  const del = async () => {
    if (!stay || !(await confirm({ title: 'Excluir hospedagem?', message: `${stay.name} sai desta parada.` }))) return;
    await run(() => source.remove('stays', { id: stay.id }).then(reload).then(onClose), { success: 'Hospedagem excluída.' });
  };
  return (
    <Dialog open onClose={onClose} title={`Onde durmo em ${stop.name}`} footer={<>{stay ? <button className="btn btn-danger tap" onClick={del}>Excluir</button> : null}<button className="btn tap" onClick={onClose}>Cancelar</button><button className="btn btn-primary tap" disabled={busy || !v.name.trim()} onClick={save}>Salvar</button></>}>
      <label className="field">Nome<input value={v.name} maxLength={120} required onChange={(e) => setV({ ...v, name: e.target.value })} /></label>
      <label className="field">Endereço<input value={v.address} maxLength={200} onChange={(e) => setV({ ...v, address: e.target.value })} /></label>
      <div className="grid2">
        <label className="field">Check-in<input type="date" value={v.checkin_date} onChange={(e) => setV({ ...v, checkin_date: e.target.value })} /></label>
        <label className="field">Horário do check-in<input type="time" value={v.checkin_time} onChange={(e) => setV({ ...v, checkin_time: e.target.value })} /></label>
        <label className="field">Check-out<input type="date" value={v.checkout_date} onChange={(e) => setV({ ...v, checkout_date: e.target.value })} /></label>
        <label className="field">Horário do check-out<input type="time" value={v.checkout_time} onChange={(e) => setV({ ...v, checkout_time: e.target.value })} /></label>
        <label className="field">Estado<select value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as Stay['status'] })}><option value="pending">Sem reserva</option><option value="booked">Reservado</option></select></label>
        <label className="field">Comprovante<select value={v.document_id} onChange={(e) => setV({ ...v, document_id: e.target.value })}><option value="">Nenhum</option>{resDocs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}</select></label>
      </div>
      <label className="field">Observações<textarea rows={2} value={v.notes} maxLength={2000} onChange={(e) => setV({ ...v, notes: e.target.value })} /></label>
    </Dialog>
  );
}

function ActivityDialog({ stop, act, onClose }: { stop: Stop; act: Activity | null; onClose: () => void }) {
  const { source, reload, bundle: b } = useBundle();
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const days = dateRange(stop.arrival_date, stop.departure_date);
  const [v, setV] = useState({ day: act?.day ?? stop.arrival_date, time: hhmm(act?.time), title: act?.title ?? '', notes: act?.notes ?? '' });
  const row = () => ({ day: v.day, time: nn(v.time), title: v.title.trim(), notes: nn(v.notes), suggested_by: null });
  const save = () =>
    run(async () => {
      if (act) await source.update('activities', act.id, row(), act.version);
      else await source.insert('activities', { ...row(), trip_id: b.trip.id, stop_id: stop.id, position: b.activities.filter((a) => a.stop_id === stop.id && a.day === v.day).length });
      await reload();
      onClose();
    }, { success: 'Plano atualizado.', onConflict: async () => { if (act) await source.update('activities', act.id, row()); await reload(); onClose(); } });
  const del = async () => {
    if (!act || !(await confirm({ title: 'Excluir atividade?', message: act.title }))) return;
    await run(() => source.remove('activities', { id: act.id }).then(reload).then(onClose), { success: 'Atividade excluída.' });
  };
  return (
    <Dialog open onClose={onClose} title={act ? 'Editar atividade' : 'Nova atividade'} footer={<>{act ? <button className="btn btn-danger tap" onClick={del}>Excluir</button> : null}<button className="btn tap" onClick={onClose}>Cancelar</button><button className="btn btn-primary tap" disabled={busy || !v.title.trim()} onClick={save}>Salvar</button></>}>
      <div className="grid2">
        <label className="field">Dia<select value={v.day} onChange={(e) => setV({ ...v, day: e.target.value })}>{days.map((d) => <option key={d} value={d}>{dayWeekU(d)}</option>)}</select></label>
        <label className="field">Horário (opcional)<input type="time" value={v.time} onChange={(e) => setV({ ...v, time: e.target.value })} /></label>
      </div>
      <label className="field">O que fazer<input value={v.title} maxLength={160} required onChange={(e) => setV({ ...v, title: e.target.value })} /></label>
      <label className="field">Notas<textarea rows={2} value={v.notes} maxLength={2000} onChange={(e) => setV({ ...v, notes: e.target.value })} /></label>
    </Dialog>
  );
}
