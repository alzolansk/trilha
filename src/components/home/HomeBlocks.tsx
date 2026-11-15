'use client';
// Blocos da Início 3.0 (planning §13). A lógica fica em lib/home.ts (pura e testada); aqui só a apresentação.
// Regra: bloco sem dado não aparece.
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Avatar } from '../ui/Avatar';
import { Photo, type PhotoData } from '../ui/Photo';
import { Icon } from '../ui/primitives';
import { useFx } from '../money/useFx';
import { useAuth } from '../../data/AuthContext';
import type { Stop, TripBundle } from '../../data/types';
import { currencyForCountry, currencySymbol } from '../../lib/currency';
import { sortedStops } from '../../lib/derive';
import { dateSpan, dayMonth, hhmm, plural } from '../../lib/format';
import { dayHash, destinationCurrency, relDay, sinceLastVisit, ticketLegs, type Milestone, type Postcard, type ReadyRow } from '../../lib/home';
import { formatMoney } from '../../lib/money';
import { phraseOfDay, phraseSetFor } from '../../lib/phrases';
import type { HomeCard, HomeCardType } from '../../lib/suggestions';
import { fetchStopWeather, type StopWeather } from '../../lib/weather';
import s from './home.module.css';

const TONE: Record<HomeCardType, 'brand' | 'warn' | 'ok' | 'mute'> = { vote: 'warn', reserve: 'brand', activity: 'brand', area: 'brand', document: 'warn', pool: 'warn' };

/** Pendências em fileira (rolagem lateral no celular, grade no desktop). */
export function PendingRow({ cards, base }: { cards: HomeCard[]; base: string }) {
  if (!cards.length) return null;
  return (
    <div className={s.row} role="group" aria-label="Pendências">
      {cards.map((c) => (
        <Link key={c.key} href={base + c.href} className={s.pill}>
          <span className={`${s.pillEyebrow} ${s[`tone-${TONE[c.type]}`]}`}>{c.eyebrow}</span>
          <span className={s.pillTitle}>{c.title}</span>
        </Link>
      ))}
    </div>
  );
}

/** Bilhete da viagem: um trecho por parada, com foto, datas, noites e carimbos; o transporte entre elas. */
export function TripTicket({ b, base, today, during }: { b: TripBundle; base: string; today: string; during: boolean }) {
  const legs = useMemo(() => ticketLegs(b, during ? today : null), [b, during, today]);
  if (!legs.length) return null;
  const first = legs[0].stop;
  const people = b.trip.party_size ?? b.members.length;
  const days = Math.max(1, Math.round((Date.parse(b.trip.end_date) - Date.parse(b.trip.start_date)) / 864e5) + 1);
  return (
    <section className={s.section} aria-labelledby="bilhete">
      <div className={s.head}>
        <h2 id="bilhete" className={s.h2}>Bilhete da viagem</h2>
        <Link href={`${base}/roteiro`} className={s.more}>Roteiro</Link>
      </div>
      <div className={s.ticket}>
        <div className={s.tkHead}>
          <div className={s.tkCol}>
            <span className={s.tkEyebrow}>{b.trip.origin ? `${b.trip.origin} → ${first.name}` : first.name} · {dayMonth(b.trip.start_date)}</span>
            <p className={s.tkTitle}>{b.trip.title}</p>
          </div>
          <div className={`${s.tkCol} ${s.tkColEnd}`}>
            <span className={s.tkEyebrow}>{plural(days, 'dia', 'dias')} · {plural(people, 'pessoa', 'pessoas')}</span>
            <span className={`${s.tkSide} num`}>{plural(legs.length, 'parada', 'paradas')}</span>
          </div>
        </div>
        <div className={s.perf} aria-hidden="true" />
        <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {legs.map((l, i) => (
            <li key={l.stop.id}>
              {i > 0 && l.hop ? <div className={s.hop}><Icon name={b.transports.find((t) => t.stop_id === l.stop.id && !t.is_return)?.mode === 'plane' ? 'plane' : 'route'} size={14} />{l.hop}</div> : null}
              <div className={`${s.leg} ${l.current ? s.legCurrent : ''}`}>
                <Photo photo={l.photo as PhotoData | null} place={l.stop.name} alt="" height="100%" radius="0" caption={false} sizes="84px" className={s.legPhoto} />
                <div className={s.legBody}>
                  <div className={s.legTop}>
                    <Link href={`${base}/roteiro/${l.stop.id}`} className={s.legName}>{l.stop.name}</Link>
                    <span className={`${s.legDates} num`}>{dateSpan(l.stop.arrival_date, l.stop.departure_date)}{l.nights ? ` · ${l.nights} n` : ''}</span>
                  </div>
                  <div className={s.stamps}>
                    {l.current ? <span className={`${s.stamp} ${s.here}`}>você está aqui</span> : null}
                    {l.stamps.map((st) => <span key={st.label} className={`${s.stamp} ${s[`stamp-${st.tone}`]}`}>{st.label}</span>)}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/** Até a partida: marcos datados (os 5 primeiros; o resto abre na hora). */
export function Milestones({ items, today, base }: { items: Milestone[]; today: string; base: string }) {
  const [all, setAll] = useState(false);
  if (!items.length) return null;
  const shown = all ? items : items.slice(0, 5);
  return (
    <section className={s.section} aria-labelledby="partida">
      <div className={s.head}>
        <h2 id="partida" className={s.h2}>Até a partida</h2>
        {items.length > 5 ? <button type="button" className={s.more} onClick={() => setAll((v) => !v)}>{all ? 'Ver menos' : `Ver os ${items.length}`}</button> : null}
      </div>
      <div className={`${s.card} ${s.ms}`}>
        {shown.map((m, i) => {
          const body = (
            <>
              <span className={`${s.msWhen} ${m.late ? s.msWhenLate : ''}`}>{m.late ? 'quanto antes' : relDay(today, m.date)}</span>
              <span className={`${s.msDot} ${m.tone === 'todo' ? s.msDotTodo : ''} ${i === 0 ? s.msDotFirst : ''}`} style={i === 0 ? { color: m.tone === 'todo' ? 'var(--warn)' : 'var(--rail)' } : undefined} aria-hidden="true" />
              <span>
                <span className={s.msTitle}>{m.title}</span>
                <span className={s.msDetail}>{[m.late ? null : dayMonth(m.date), m.detail].filter(Boolean).join(' · ')}</span>
              </span>
            </>
          );
          return m.href ? <Link key={m.key} href={base + m.href} className={s.msRow}>{body}</Link> : <div key={m.key} className={s.msRow}>{body}</div>;
        })}
      </div>
    </section>
  );
}

/** A turma está pronta? Você vê o que falta de você; dos outros, só quantos itens. */
export function Readiness({ rows, base }: { rows: ReadyRow[] | null; base: string }) {
  if (!rows?.length) return null;
  return (
    <section className={s.section} aria-labelledby="pronta">
      <div className={s.head}>
        <h2 id="pronta" className={s.h2}>A turma está pronta?</h2>
        <Link href={`${base}/turma`} className={s.more}>Turma</Link>
      </div>
      <div className={`${s.card} ${s.ready}`}>
        {rows.map((r) => {
          const done = r.dims.filter((d) => d.ok).length;
          return (
            <div key={r.userId} className={s.rRow}>
              <Avatar name={r.name} color={r.color} me={r.me} size={36} />
              <span className={s.rName}>
                {r.name}
                {r.dims.length ? (
                  <span className={s.bars} role="img" aria-label={`${done} de ${r.dims.length} prontos`}>
                    {r.dims.map((d) => <i key={d.key} className={`${s.bar} ${d.ok ? s.barOk : ''}`} title={d.label} />)}
                  </span>
                ) : null}
              </span>
              <span className={`${s.rMiss} ${r.missing.length ? '' : s.rOk}`}>
                {!r.dims.length ? '' : !r.missing.length ? 'tudo certo' : r.me ? `falta ${r.missing.join(', ')}` : `falta ${plural(r.missing.length, 'item', 'itens')}`}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Postal do dia: um passeio do roteiro, a frase do dia e quando a turma passa lá. */
export function PostcardBlock({ pc, b, base, today }: { pc: Postcard | null; b: TripBundle; base: string; today: string }) {
  if (!pc) return null;
  const { activity: a, stop, dayNumber } = pc;
  const photo = (a.photo?.url ? a.photo : null) as PhotoData | null;
  const set = phraseSetFor(stop.country);
  const phrase = set ? phraseOfDay(set, dayHash(`${b.trip.id}|${today}|frase`)) : null;
  const cur = a.cost_currency ?? b.trip.base_currency;
  const cost = a.cost_cents === 0 ? 'grátis' : a.cost_cents ? `${formatMoney(a.cost_cents, cur, { compact: true })}/pessoa${a.cost_is_estimate ? ' (estimativa)' : ''}` : null;
  return (
    <section className={s.section} aria-labelledby="postal">
      <div className={s.head}>
        <h2 id="postal" className={s.h2}>Postal de hoje</h2>
        <span className={s.tag}>MUDA TODO DIA</span>
      </div>
      <article className={s.postal}>
        {/* sem foto conferida, o postal fica só com o texto (a tela encolhe em vez de enfeitar) */}
        {photo ? <Photo photo={photo} place={a.title} ratio="4/3" radius="0" sizes="(min-width: 821px) 640px, 100vw" /> : null}
        <div className={s.postalBody}>
          <span className={`${s.pillEyebrow} ${s['tone-brand']}`}>{stop.name} · dia {dayNumber} do roteiro</span>
          <h3 className={s.postalTitle}><Link href={`${base}/roteiro/${stop.id}`}>{a.title}</Link></h3>
          {a.notes ? <p className={s.note} style={{ fontSize: 14, color: 'var(--ink-2)' }}>{a.notes}</p> : null}
          <div className={s.chips}>
            <span className={`${s.chip} ${s.chipBrand}`}><Icon name="cal" size={13} />{relDay(today, a.day) === 'amanhã' ? 'amanhã' : `dia ${dayNumber}, ${dayMonth(a.day)}`}{a.time ? `, ${hhmm(a.time)}` : ''}</span>
            {cost ? <span className={s.chip}>{cost}</span> : null}
          </div>
          {phrase && set ? (
            <div className={s.phrase}>
              <div className={s.phraseText} lang={set.lang}>
                <b>{phrase.text}</b>
                <span lang="pt-BR">{phrase.say ? `${phrase.say} · ` : ''}{phrase.meaning}</span>
              </div>
              <span className={s.tag}>FRASE DO DIA</span>
            </div>
          ) : null}
        </div>
      </article>
    </section>
  );
}

function useStopsWeather(stops: Stop[], today: string): StopWeather[] {
  const { online } = useAuth();
  const key = stops.map((x) => `${x.id}|${x.lat}|${x.lng}|${x.arrival_date}|${x.departure_date}`).join(',');
  const [out, setOut] = useState<StopWeather[]>([]);
  useEffect(() => {
    if (!stops.length || !online) return;
    let alive = true;
    void Promise.all(stops.map((x) => fetchStopWeather(x, today))).then((r) => {
      if (alive) setOut(r.filter((x): x is StopWeather => !!x));
    });
    return () => {
      alive = false;
    };
  }, [key, today, online]); // eslint-disable-line react-hooks/exhaustive-deps
  return out;
}

const nf = (n: number, digits: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Como estará (clima das próximas paradas) e câmbio de hoje. */
export function WeatherFx({ b, today }: { b: TripBundle; today: string }) {
  const upcoming = useMemo(() => sortedStops(b).filter((x) => x.departure_date > today && x.lat != null).slice(0, 4), [b, today]);
  const wx = useStopsWeather(upcoming, today);
  const cur = destinationCurrency(b, currencyForCountry);
  const base = b.trip.base_currency;
  const { fx } = useFx(base);
  const rate = cur && fx?.base === base ? fx.rates[cur] : null;
  if (!wx.length && !rate) return null;
  const lastYearOnly = wx.length > 0 && wx.every((w) => w.kind === 'lastYear');
  const digits = rate && rate >= 100 ? 0 : 2;
  return (
    <section className={s.section} aria-labelledby="clima">
      <div className={s.head}>
        <h2 id="clima" className={s.h2}>{wx.length ? 'Como estará' : 'Câmbio'}</h2>
        {lastYearOnly ? <span className={s.tag}>NO ANO PASSADO</span> : null}
      </div>
      {wx.length ? (
        <>
          <div className={s.wx}>
            {wx.map((w) => {
              const stop = upcoming.find((x) => x.id === w.stopId)!;
              const rain = w.rain == null ? null : w.kind === 'forecast' ? `chuva ${w.rain}%` : w.rain ? `chuva em ${w.rain} d` : 'sem chuva';
              return (
                <div key={w.stopId} className={s.wxCell}>
                  <span className={s.wxName}>{stop.name}</span>
                  <b className={`${s.wxMax} num`}>{w.max}°</b>
                  <span className={`${s.wxSub} num`}>mín {w.min}°</span>
                  {rain ? <span className={s.wxSub}>{rain}</span> : null}
                  {!lastYearOnly ? <span className={s.wxSub}>{w.kind === 'forecast' ? 'previsão' : 'ano passado'}</span> : null}
                </div>
              );
            })}
          </div>
          <p className={s.note}>
            {lastYearOnly ? 'Como foi nas mesmas datas do ano passado (Open-Meteo). A 15 dias da chegada, vira previsão.' : 'Previsão e histórico da Open-Meteo.'}
          </p>
        </>
      ) : null}
      {rate && cur ? (
        <div className={`${s.card} ${s.fx}`}>
          <div className={s.fxText}>
            <span className={`${s.pillEyebrow} ${s['tone-mute']}`}>Câmbio hoje · {fx?.date ? dayMonth(fx.date) : ''}</span>
            <span className={s.note} style={{ fontSize: 13 }}>
              {currencySymbol(cur)} 1.000 ≈ {formatMoney(Math.round((1000 / rate) * 100), base)}
            </span>
          </div>
          <span className={`${s.fxBig} num`} aria-label={`${nf(rate, digits)} ${cur} por 1 ${base}`}>{currencySymbol(cur)} {nf(rate, digits)}<span className={s.note} style={{ display: 'block', textAlign: 'right' }}>por {currencySymbol(base)} 1</span></span>
        </div>
      ) : null}
    </section>
  );
}

const WEEK = 7 * 864e5;
function ago(iso: string, now: number): string {
  const min = Math.max(1, Math.round((now - Date.parse(iso)) / 60000));
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'ontem' : `há ${d} dias`;
}

/** Desde sua última visita: o que a turma e o roteiro mudaram. Guarda a visita neste aparelho. */
export function SinceLastVisit({ b, me, base }: { b: TripBundle; me: string; base: string }) {
  const storeKey = `trilha.seen.${b.trip.id}.${me}`;
  const [since, setSince] = useState<string | null>(null);
  useEffect(() => {
    let prev: string | null = null;
    try {
      prev = localStorage.getItem(storeKey);
    } catch {
      /* sem armazenamento */
    }
    setSince(prev ?? new Date(Date.now() - WEEK).toISOString());
    // Conta como visto depois de alguns segundos na tela (não ao passar rápido).
    const t = setTimeout(() => {
      try {
        localStorage.setItem(storeKey, new Date().toISOString());
      } catch {
        /* só não guarda */
      }
    }, 4000);
    return () => clearTimeout(t);
  }, [storeKey]);
  const items = useMemo(() => (since ? sinceLastVisit(b, me, since) : []), [b, me, since]);
  if (!items.length) return null;
  const now = Date.now();
  const person = (uid: string | null) => {
    const p = uid ? b.profiles.find((x) => x.id === uid) : null;
    return p ? <Avatar name={p.display_name} color={p.color} size={30} /> : <span className={s.feedIcon}><Icon name="route" size={15} /></span>;
  };
  return (
    <section className={s.section} aria-labelledby="novidades">
      <div className={s.head}>
        <h2 id="novidades" className={s.h2}>Desde sua última visita</h2>
      </div>
      <div className={`${s.card} ${s.feed}`}>
        {items.map((it) => (
          <Link key={it.key} href={base + it.href} className={s.feedRow}>
            {person(it.who)}
            <p className={s.feedText}>{it.text}<span className={s.feedWhen}>{ago(it.at, now)}</span></p>
          </Link>
        ))}
      </div>
    </section>
  );
}
