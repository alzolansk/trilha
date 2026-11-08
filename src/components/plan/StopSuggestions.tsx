'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useBundle } from '../../data/TripContext';
import type { Stop } from '../../data/types';
import { callAiOrError } from '../../lib/ai/client';
import { activityCapForStop, fitOf, headcount, nightlyCap, rangeLabel, staySearchLinks, stopNights, type Fit } from '../../lib/explore';
import { dayWeekU } from '../../lib/format';
import { formatMoney } from '../../lib/money';
import { dateRange } from '../../lib/time';
import { useAction } from '../ui/feedback';
import { Icon } from '../ui/primitives';
import { Estimate, EstimateNote, FitBadge } from './PlanBits';
import p from './plan.module.css';

interface Act { title: string; why: string; duration: string; cost_low: number; cost_high: number }
interface Area { name: string; why: string; price_low: number; price_high: number }

const ORDER: Fit[] = ['free', 'fits', 'unknown', 'over'];
/** Tetos aparecem em reais inteiros (são referência, não conta exata). */
const whole = (c: number) => Math.round(c / 100) * 100;
const GROUP: Record<Fit, string> = { free: 'Grátis', fits: 'Cabe no teto', unknown: 'Sugestões', over: 'Passa do teto' };

/** Passeios que cabem no orçamento e onde ficar, dentro do detalhe da parada. */
export function StopSuggestions({ stop }: { stop: Stop }) {
  const { bundle: b, base, canEdit, source, reload } = useBundle();
  const { run, busy } = useAction();
  const cur = b.trip.base_currency;
  const demo = source.kind === 'demo';
  const nights = stopNights(stop);
  const cap = activityCapForStop(b, stop);
  const nCap = nightlyCap(b);
  const days = dateRange(stop.arrival_date, stop.departure_date);
  const [day, setDay] = useState(days[0] ?? stop.arrival_date);
  const [acts, setActs] = useState<{ items: Act[]; model?: string } | null>(null);
  const [areas, setAreas] = useState<{ items: Area[]; model?: string } | null>(null);
  const [err, setErr] = useState<{ acts?: string; areas?: string }>({});
  const [loading, setLoading] = useState<'acts' | 'areas' | null>(null);
  const [added, setAdded] = useState<string[]>([]);

  const loadActs = async () => {
    setLoading('acts');
    const r = await callAiOrError<{ items: Act[] }>('explore', { kind: 'activities', tripId: b.trip.id, stopId: stop.id, capPerPerson: cap ? Math.round(cap / 100) : null });
    setLoading(null);
    if (!r.ok) return setErr((e) => ({ ...e, acts: r.error }));
    setErr((e) => ({ ...e, acts: undefined }));
    setActs({ items: r.res.data.items, model: r.res.model });
  };
  const loadAreas = async () => {
    setLoading('areas');
    const r = await callAiOrError<{ areas: Area[] }>('explore', { kind: 'stays', tripId: b.trip.id, stopId: stop.id, nightlyCap: nCap ? Math.round(nCap / 100) : null });
    setLoading(null);
    if (!r.ok) return setErr((e) => ({ ...e, areas: r.error }));
    setErr((e) => ({ ...e, areas: undefined }));
    setAreas({ items: r.res.data.areas, model: r.res.model });
  };

  const addAct = (a: Act) =>
    run(async () => {
      await source.insert('activities', {
        trip_id: b.trip.id, stop_id: stop.id, day, time: null, title: a.title.slice(0, 120), suggested_by: 'ai',
        notes: `${a.duration ? `${a.duration} · ` : ''}${rangeLabel(a.cost_low * 100, a.cost_high * 100, cur)}/pessoa (estimativa)`,
        position: b.activities.filter((x) => x.stop_id === stop.id && x.day === day).length,
      });
      await reload();
      setAdded((x) => [...x, a.title]);
    }, { success: `${a.title} entrou no plano de ${dayWeekU(day)}.` });

  const grouped = acts
    ? ORDER.map((f) => ({ f, list: acts.items.filter((a) => fitOf(a.cost_low * 100, a.cost_high * 100, cap) === f) })).filter((g) => g.list.length)
    : [];
  const links = nights > 0 ? staySearchLinks([stop.name, stop.country].filter(Boolean).join(', '), stop.arrival_date, stop.departure_date, headcount(b)) : [];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(300px,100%),1fr))', gap: 18 }}>
      <section className={p.panel} aria-labelledby={`pas-${stop.id}`}>
        <h3 id={`pas-${stop.id}`} className="h3" style={{ margin: 0 }}><Icon name="sparkle" size={16} sw={1.6} />Passeios que cabem</h3>
        <span className={p.cap}>
          {cap ? <>Teto por pessoa nesta parada: <b>{formatMoney(whole(cap), cur, { compact: true })}</b> (parte de Passeios no orçamento)</> : <>Sem teto de passeios. <Link href={`${base}/dinheiro/orcamento`}>Definir orçamento</Link> pra separar o que cabe.</>}
        </span>
        {!demo ? (
          <button className="btn btn-sm tap" style={{ alignSelf: 'flex-start' }} onClick={loadActs} disabled={loading === 'acts'}>
            {loading === 'acts' ? 'Procurando…' : acts ? 'Sugerir outros' : 'Sugerir passeios'}
          </button>
        ) : <span className={p.cap}>Na demonstração as sugestões da IA ficam desligadas.</span>}
        {err.acts ? <div className="errbox" role="alert">{err.acts}</div> : null}
        {acts ? (
          <>
            {canEdit && days.length > 1 ? (
              <label className="field" style={{ maxWidth: 220 }}>Pôr no dia<select value={day} onChange={(e) => setDay(e.target.value)}>{days.map((d) => <option key={d} value={d}>{dayWeekU(d)}</option>)}</select></label>
            ) : null}
            {grouped.map((g) => (
              <div key={g.f} className={p.panel}>
                <span className="eyebrow" style={{ fontSize: 11 }}>{GROUP[g.f]}</span>
                <ul className={p.list}>
                  {g.list.map((a) => (
                    <li key={a.title} className={p.item} data-fit={g.f}>
                      <div className={p.itemMain}>
                        <b>{a.title}</b>
                        <span>{[a.duration, rangeLabel(a.cost_low * 100, a.cost_high * 100, cur) + ' por pessoa'].filter(Boolean).join(' · ')}</span>
                        <span>{a.why}</span>
                      </div>
                      <FitBadge fit={g.f} high={a.cost_high * 100} cap={cap} currency={cur} />
                      {canEdit ? (
                        added.includes(a.title)
                          ? <span className="pill" data-tone="ink"><Icon name="check" size={14} />No plano</span>
                          : <button className="btn btn-sm tap" disabled={busy} onClick={() => addAct(a)}>+ Plano</button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <EstimateNote model={acts.model} />
          </>
        ) : null}
      </section>

      {nights > 0 ? (
        <section className={p.panel} aria-labelledby={`hosp-${stop.id}`}>
          <h3 id={`hosp-${stop.id}`} className="h3" style={{ margin: 0 }}><Icon name="bed" size={16} />Onde ficar</h3>
          <span className={p.cap}>
            {nCap ? <>Teto da diária pra turma: <b>{formatMoney(whole(nCap), cur, { compact: true })}</b> ({formatMoney(whole(nCap / headcount(b)), cur, { compact: true })} por pessoa)</> : <>Sem teto de hospedagem. <Link href={`${base}/dinheiro/orcamento`}>Definir orçamento</Link>.</>}
          </span>
          <div className={p.links}>
            {links.map((l) => <a key={l.label} href={l.url} target="_blank" rel="noopener noreferrer">{l.label} <Icon name="link" size={14} /></a>)}
          </div>
          <span className={p.cap}>Busca já com {stop.name}, datas e {headcount(b)} {headcount(b) === 1 ? 'pessoa' : 'pessoas'}. O Trilha não reserva nada.</span>
          {!demo ? (
            <button className="btn btn-sm tap" style={{ alignSelf: 'flex-start' }} onClick={loadAreas} disabled={loading === 'areas'}>
              {loading === 'areas' ? 'Procurando…' : areas ? 'Sugerir de novo' : 'Que bairro escolher?'}
            </button>
          ) : null}
          {err.areas ? <div className="errbox" role="alert">{err.areas}</div> : null}
          {areas ? (
            <>
              <ul className={p.list}>
                {areas.items.map((a) => {
                  const f = fitOf(a.price_low * 100, a.price_high * 100, nCap);
                  return (
                    <li key={a.name} className={p.item} data-fit={f}>
                      <div className={p.itemMain}><b>{a.name}</b><span>{a.why}</span></div>
                      <Estimate low={a.price_low * 100} high={a.price_high * 100} currency={cur} suffix="a diária" />
                      <FitBadge fit={f} high={a.price_high * 100} cap={nCap} currency={cur} />
                    </li>
                  );
                })}
              </ul>
              <EstimateNote model={areas.model} />
            </>
          ) : null}
          {canEdit ? <Link href={`${base}/turma#nova-votacao-stay-${stop.id}`} style={{ fontWeight: 600 }}>Achou opções? Comparar e votar com a turma →</Link> : null}
          <span className={p.cap}>Reservou? Envie a confirmação em Documentos: ela fica offline e liga na parada.</span>
        </section>
      ) : null}
    </div>
  );
}
