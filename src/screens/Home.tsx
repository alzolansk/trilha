'use client';
import Link from 'next/link';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AiTag, Floaters, Icon, Marquee, Pattern, type FloatSpot } from '../components/ui/primitives';
import { useAction, useToast } from '../components/ui/feedback';
import { useBundle } from '../data/TripContext';
import { deleteFile, getFile, saveFile } from '../data/offline';
import {
  departureLabel, legToNext, packingProgress, sortedStops, stopCode, stopDates, stopMeta, stopNights, straightKm,
  totalSpentCents, tripPhase, tripTarget,
} from '../lib/derive';
import { pad2 } from '../lib/format';
import { landscapeInner } from '../lib/identity/render';
import { clamp01, clipFor, easeOutCubic, pathFractions, routePoints, smoothPath } from '../lib/identity/shapes';
import { colorCycle } from '../lib/identity/theme';
import { compressImage } from '../lib/image';
import { canDecide, myPendingVotes, pollState, votersCount } from '../lib/polls';
import { ruleAlerts, ruleTip } from '../lib/rules';
import { countdown } from '../lib/time';
import s from './home.module.css';

function useReducedMotion() {
  const [r, setR] = useState(false);
  useEffect(() => {
    const m = matchMedia('(prefers-reduced-motion: reduce)');
    setR(m.matches);
    const on = () => setR(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return r;
}

/** Capa: cópia local (offline) ou URL assinada; null = paisagem do tema. */
function useCover() {
  const { bundle, source } = useBundle();
  const [url, setUrl] = useState<string | null>(null);
  const path = bundle.trip.cover_path;
  useEffect(() => {
    let alive = true;
    let obj: string | null = null;
    (async () => {
      if (!path) return setUrl(null);
      const key = `cover-${bundle.trip.id}`;
      const local = source.kind === 'supabase' ? await getFile(source.userId, key) : null;
      if (local && local.docUpdatedAt === path) {
        obj = URL.createObjectURL(local.blob);
        if (alive) setUrl(obj);
        return;
      }
      try {
        const blob = await source.download('covers', path);
        if (source.kind === 'supabase') {
          await saveFile(source.userId, { docId: key, tripId: bundle.trip.id, blob, mime: blob.type, name: 'capa', size: blob.size, savedAt: new Date().toISOString(), docUpdatedAt: path }).catch(() => undefined);
        }
        obj = URL.createObjectURL(blob);
        if (alive) setUrl(obj);
      } catch {
        if (alive) setUrl(null);
      }
    })();
    return () => {
      alive = false;
      if (obj) URL.revokeObjectURL(obj);
    };
  }, [path, bundle.trip.id, source]);
  return url;
}

export default function Home() {
  const { bundle: b, identity, base, canEdit, source, reload, me } = useBundle();
  const reduced = useReducedMotion();
  const toast = useToast();
  const { run } = useAction();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const trip = b.trip;
  const stops = useMemo(() => sortedStops(b), [b]);
  const cols = colorCycle(identity);
  const cover = useCover();
  const target = tripTarget(trip);
  const [now, setNow] = useState(() => Date.now());
  const phase = tripPhase(trip, now);
  const cd = countdown(now, target, trip.departure_tz || 'America/Sao_Paulo');
  const dest = trip.title;

  // Refs para escrita direta de estilos no scroll (sem re-render por frame).
  const r = {
    hero: useRef<HTMLElement>(null), photo: useRef<HTMLDivElement>(null), land: useRef<HTMLDivElement>(null),
    cdA: useRef<HTMLDivElement>(null), cdB: useRef<HTMLDivElement>(null), ttl: useRef<HTMLDivElement>(null),
    scrim: useRef<HTMLDivElement>(null), hint: useRef<HTMLDivElement>(null), heroPat: useRef<HTMLDivElement>(null),
    route: useRef<HTMLElement>(null), rPath: useRef<SVGPathElement>(null), nums: useRef<HTMLElement>(null),
    pend: useRef<HTMLElement>(null), fin: useRef<HTMLElement>(null), prog: useRef<HTMLDivElement>(null),
    fTitle: useRef<HTMLHeadingElement>(null), fAct: useRef<HTMLDivElement>(null),
    rNum: useRef<HTMLSpanElement>(null), rCity: useRef<HTMLHeadingElement>(null), rMeta: useRef<HTMLDivElement>(null),
    rDates: useRef<HTMLSpanElement>(null), rNights: useRef<HTMLSpanElement>(null), rTip: useRef<HTMLDivElement>(null), rLeg: useRef<HTMLDivElement>(null),
  };

  // Linha ilustrativa (zigue-zague do protótipo); posições reais ficam no mapa do Roteiro.
  const geo = useMemo(() => routePoints(stops.map(() => ({ lat: null, lng: null }))), [stops]);
  const routeD = useMemo(() => smoothPath(geo.pts), [geo]);
  const fr = useMemo(() => pathFractions(geo.pts), [geo]);
  const tips = useMemo(() => stops.map((st) => st.tip ?? (ruleTip(b, st) ? { ...ruleTip(b, st)!, by: 'rules' as const } : null)), [stops, b]);

  const km = straightKm(stops);
  const spent = totalSpentCents(b);
  const pack = packingProgress(b);
  const stats: { v: number; pre: string; suf: string; label: string }[] = [
    { v: Math.max(1, Math.round((Date.parse(trip.end_date) - Date.parse(trip.start_date)) / 864e5) + 1), pre: '', suf: '', label: 'dias de viagem' },
    { v: stops.length, pre: '', suf: '', label: stops.length === 1 ? 'parada' : 'paradas' },
    km.complete ? { v: km.km, pre: '', suf: '', label: 'km em linha reta entre as paradas' } : { v: b.documents.length, pre: '', suf: '', label: 'documentos salvos' },
    { v: Math.round(spent / 100), pre: trip.base_currency === 'BRL' ? 'R$ ' : `${trip.base_currency} `, suf: '', label: 'gastos até agora' },
    { v: pack.pct, pre: '', suf: '%', label: 'da mala pronta' },
  ];

  const rows = useMemo(() => {
    const out: { key: string; title: string; detail: string; href: string; cta: string; by: 'ai' | 'rules' | null }[] = [];
    // Votação: por pessoa e derivado do que já está no pacote (não vira tarefa no banco).
    for (const p of myPendingVotes(b, me)) {
      const { voted, total } = votersCount(b, p.id);
      out.push({ key: `vote-${p.id}`, title: `Falta seu voto: ${p.question}`, detail: `${voted} de ${total} já votaram.`, href: `${base}/turma#decisoes`, cta: 'Votar', by: null });
    }
    for (const p of (b.polls ?? []).filter((x) => pollState(b, x.id) === 'awaiting_decision' && canDecide(b, x, me))) {
      out.push({ key: `decide-${p.id}`, title: `Hora de decidir: ${p.question}`, detail: 'O prazo da votação acabou.', href: `${base}/turma#decisoes`, cta: 'Decidir', by: null });
    }
    for (const t of b.tasks.filter((x) => x.status !== 'done' && !x.dismissed).sort((a, c) => (a.due_date ?? '9').localeCompare(c.due_date ?? '9'))) {
      out.push({ key: t.id, title: t.title, detail: t.detail ?? (t.due_date ? `Prazo ${t.due_date.split('-').reverse().slice(0, 2).join('/')}` : ''), href: `${base}/${t.link === 'turma' ? 'turma' : t.link}`, cta: 'Abrir', by: t.source === 'user' ? null : t.source });
    }
    for (const a of ruleAlerts(b)) {
      if (out.some((o) => o.title === a.title)) continue;
      out.push({ key: a.key, title: a.title, detail: a.detail, href: `${base}/${a.link}`, cta: a.cta, by: 'rules' });
    }
    return out.slice(0, 5);
  }, [b, base, me]);

  // Countdown: texto atualiza a cada 1s; leitores de tela recebem uma frase estável.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Confete de motifs no dia da viagem (uma vez por trilha).
  const [confetti, setConfetti] = useState(false);
  useEffect(() => {
    if (phase.kind !== 'today' || reduced) return;
    const k = `trilha.confetti.${trip.id}`;
    try {
      if (localStorage.getItem(k)) return;
      localStorage.setItem(k, '1');
    } catch {
      /* ignora */
    }
    setConfetti(true);
    const t = setTimeout(() => setConfetti(false), 3600);
    return () => clearTimeout(t);
  }, [phase.kind, reduced, trip.id]);

  // História de scroll: um handler passivo + rAF (SPEC §8.2). Unidades em px: vh = innerHeight.
  useEffect(() => {
    if (reduced) return;
    let lastCur = -1;
    let ticking = false;
    const pars = () => Array.from(r.land.current?.querySelectorAll<SVGGElement>('[data-par]') ?? []);
    const segs = () => Array.from(document.querySelectorAll<HTMLSpanElement>(`.${s.segs} span`));
    const rs = () => Array.from(document.querySelectorAll<SVGGElement>('[data-rs]'));
    const stats = () => Array.from(document.querySelectorAll<HTMLElement>('[data-stat]'));
    const lis = () => Array.from(r.pend.current?.querySelectorAll<HTMLLIElement>('li') ?? []);
    const fades = () => Array.from(r.hero.current?.querySelectorAll<HTMLElement>('[data-fade]') ?? []);
    const run = () => {
      ticking = false;
      const y = window.scrollY;
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      const hero = r.hero.current;
      if (hero && r.photo.current) {
        const p1 = clamp01((y - hero.offsetTop) / (1.6 * vh));
        const e1 = easeOutCubic(p1);
        r.photo.current.style.clipPath = clipFor(identity.slit, e1, vw);
        if (r.land.current) r.land.current.style.transform = `scale(${1.18 - 0.18 * e1})`;
        const speeds = [0.05, 0.1, 0.16, 0.24];
        for (const g of pars()) g.style.transform = `translateY(${Math.round(y * speeds[Number(g.dataset.par)] )}px)`;
        const fo = clamp01(1 - p1 * 1.8);
        for (const f of fades()) f.style.opacity = String(fo);
        if (r.heroPat.current) r.heroPat.current.style.opacity = String(0.12 * clamp01(1 - p1 * 1.2));
        const sh = Math.round(e1 * (identity.split === 'h' ? 380 : 560));
        if (r.cdA.current && r.cdB.current) {
          if (identity.split === 'h') {
            r.cdA.current.style.transform = `translateY(${-sh}px)`;
            r.cdB.current.style.transform = `translateY(${sh}px)`;
          } else {
            r.cdA.current.style.transform = `translate(${-sh}px,-50%)`;
            r.cdB.current.style.transform = `translate(${sh}px,-50%)`;
          }
        }
        const to = clamp01((p1 - 0.62) / 0.3);
        if (r.ttl.current) {
          r.ttl.current.style.opacity = String(to);
          r.ttl.current.style.transform = `translateY(${Math.round((1 - to) * 60)}px)`;
          r.ttl.current.style.pointerEvents = to > 0.5 ? 'auto' : 'none';
        }
        if (r.scrim.current) r.scrim.current.style.opacity = String(to);
        if (r.hint.current) r.hint.current.style.opacity = String(clamp01(1 - p1 * 5));
      }
      const route = r.route.current;
      if (route && r.rPath.current && stops.length) {
        const p2 = clamp01((y - route.offsetTop) / (2 * vh));
        r.rPath.current.setAttribute('stroke-dashoffset', (1 - p2).toFixed(4));
        let cur = 0;
        fr.forEach((f, i) => {
          if (p2 >= f - 0.002) cur = i;
        });
        rs().forEach((g, i) => {
          const lit = p2 >= fr[i] - 0.002;
          g.style.opacity = lit ? '1' : '0.35';
          const c = g.querySelector('circle');
          c?.setAttribute('r', i === cur ? '12' : '7');
          c?.setAttribute('fill', lit ? 'var(--route)' : 'var(--deep)');
        });
        segs().forEach((sg, i) => (sg.style.background = i <= cur ? 'var(--route)' : ''));
        if (cur !== lastCur) {
          lastCur = cur;
          const st = stops[cur];
          if (r.rNum.current) r.rNum.current.textContent = String(cur + 1);
          if (r.rCity.current) {
            r.rCity.current.textContent = st.name;
            r.rCity.current.style.animation = 'none';
            void r.rCity.current.offsetWidth;
            r.rCity.current.style.animation = 'popin .5s var(--ease-spring) both';
          }
          if (r.rMeta.current) r.rMeta.current.textContent = [st.country, stopMeta(st)].filter(Boolean).join(' · ');
          if (r.rDates.current) r.rDates.current.textContent = stopDates(st);
          if (r.rNights.current) r.rNights.current.textContent = stopNights(st);
          if (r.rTip.current) {
            const tip = tips[cur];
            r.rTip.current.style.display = tip ? '' : 'none';
            const span = r.rTip.current.querySelector('[data-tip-text]');
            const tag = r.rTip.current.querySelector('[data-tip-tag]');
            if (span) span.textContent = tip?.text ?? '';
            if (tag) tag.textContent = tip?.by === 'ai' ? 'IA' : 'AUTO';
          }
          if (r.rLeg.current) {
            const leg = legToNext(b, stops, cur);
            r.rLeg.current.textContent = leg ? `PRÓXIMO TRECHO · ${leg}` : '';
          }
        }
      }
      if (r.nums.current) {
        const p3 = easeOutCubic(clamp01((y - (r.nums.current.offsetTop - 0.7 * vh)) / (0.6 * vh)));
        for (const el of stats()) {
          const v = Number(el.dataset.v);
          const bEl = el.querySelector('b');
          if (bEl) bEl.textContent = `${el.dataset.pre}${Math.round(v * p3).toLocaleString('pt-BR')}${el.dataset.suf}`;
          el.style.setProperty('--p', String(p3));
        }
      }
      if (r.pend.current) {
        const p4 = clamp01((y - (r.pend.current.offsetTop - 0.6 * vh)) / (0.9 * vh));
        const items = lis();
        items.forEach((li, k) => {
          const q = easeOutCubic(clamp01(p4 * items.length - k));
          li.style.opacity = String(q);
          li.style.transform = `translateY(${Math.round((1 - q) * 40)}px)`;
          li.style.setProperty('--q', String(q));
        });
      }
      if (r.fin.current && r.fTitle.current && r.fAct.current) {
        const p5 = easeOutCubic(clamp01((y - (r.fin.current.offsetTop - 0.6 * vh)) / (0.6 * vh)));
        r.fTitle.current.style.opacity = String(p5);
        r.fTitle.current.style.transform = `scale(${0.92 + 0.08 * p5})`;
        r.fAct.current.style.opacity = String(p5);
      }
      if (r.prog.current) r.prog.current.style.width = `${clamp01(y / (document.documentElement.scrollHeight - vh)) * 100}%`;
    };
    const on = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(run);
      }
    };
    window.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    run();
    return () => {
      window.removeEventListener('scroll', on);
      window.removeEventListener('resize', on);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, identity, stops, fr, tips, cover]);

  async function changeCover(file: File) {
    if (!/^image\//.test(file.type) && !/\.hei[cf]$/i.test(file.name)) return toast('Escolha uma imagem (JPG, PNG, WebP ou HEIC).');
    await run(async () => {
      const img = await compressImage(file, 2400, 0.82);
      const path = `${trip.id}/${crypto.randomUUID()}.${img.type === 'image/webp' ? 'webp' : 'jpg'}`;
      await source.upload('covers', path, img.blob, img.type);
      const old = trip.cover_path;
      try {
        await source.update('trips', trip.id, { cover_path: path });
      } catch (e) {
        await source.removeFiles('covers', [path]).catch(() => undefined); // evita arquivo órfão
        throw e;
      }
      if (old) await source.removeFiles('covers', [old]).catch(() => undefined);
      if (source.kind === 'supabase') await deleteFile(source.userId, `cover-${trip.id}`).catch(() => undefined);
      await reload();
    }, { success: 'Foto aplicada. Role pra ver a fenda abrir.' });
  }

  const landHtml = useMemo(() => landscapeInner(identity, uid), [identity, uid]);
  const days = cd.totalDays;
  const sentence =
    phase.kind === 'before' ? `Faltam ${days} dias para ${dest}.` : phase.kind === 'today' ? `É hoje: ${dest}.` : phase.kind === 'during' ? `Dia ${phase.day} de ${phase.total} em ${dest}.` : `Há ${phase.daysAgo} dias você voltou de ${dest}.`;
  const cdUnit = (v: number, l: string) => (
    <div className={s.u}>
      <span className={s.n} suppressHydrationWarning>{pad2(v)}</span>
      <span className={s.l}>{l}</span>
    </div>
  );
  const pointsFloat: FloatSpot[] = [['84%', '10%', 150, 'acc2', 0.5, -0.25], ['-40px', '60%', 110, 'acc3', 0.45, 0.2]];
  const pendFloat: FloatSpot[] = [['78%', '18%', 120, 'acc', 0.45, -0.25], ['8%', '70%', 80, 'acc2', 0.5, 0.2], ['50%', '88%', 60, 'acc3', 0.4, -0.15]];

  return (
    <div className={reduced ? s.reduced : undefined}>
      {!reduced ? <div className={s.progress} ref={r.prog} /> : null}
      {confetti ? (
        <div className={s.confetti} aria-hidden="true">
          {Array.from({ length: 28 }, (_, i) => (
            <i key={i} style={{ left: `${(i * 37) % 100}%`, background: cols[i % 4], animationDelay: `${(i % 7) * 0.12}s` }} />
          ))}
        </div>
      ) : null}
      <section className={`${s.hero} ${identity.split === 'h' ? s.splitH : ''}`} ref={r.hero} aria-label="Contagem regressiva">
        <div className={s.stage}>
          <div className={s.pat} ref={r.heroPat}>
            <Pattern identity={identity} />
          </div>
          <div className={s.photo} ref={r.photo} style={{ clipPath: reduced ? 'none' : clipFor(identity.slit, 0, 1280) }}>
            <div ref={r.land} style={{ position: 'absolute', inset: 0, transformOrigin: '50% 60%' }}>
              {cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img alt={`Foto da viagem: ${dest}`} src={cover} />
              ) : (
                <svg className="land" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true" dangerouslySetInnerHTML={{ __html: landHtml }} />
              )}
            </div>
            <div className={s.scrim} ref={r.scrim} style={{ opacity: reduced ? 1 : 0 }} />
            <div className={s.ttl} ref={r.ttl} style={{ opacity: reduced ? 1 : 0 }}>
              <div>
                <div className="mono" style={{ fontSize: 13, letterSpacing: '.16em' }}>{departureLabel(b)}</div>
                <h1 className="disp">{dest}</h1>
              </div>
              {canEdit ? (
                <label className="btn tap">
                  <Icon name="camera" size={18} />
                  Trocar foto
                  <input type="file" accept="image/*,.heic,.heif" className="sr" onChange={(e) => e.target.files?.[0] && void changeCover(e.target.files[0])} />
                </label>
              ) : null}
            </div>
          </div>
          <p className="sr" aria-live="off" suppressHydrationWarning>{sentence}</p>
          <div className={reduced ? s.cdBox : undefined} aria-hidden="true">
            {phase.kind === 'before' ? (
              <>
                <div className={`${s.cdLabel} mono`} data-fade>FALTAM PARA {dest.toUpperCase()}</div>
                <div className={`${s.cd} ${s.cdA}`} data-fade ref={r.cdA} style={{ transform: identity.split === 'h' ? undefined : 'translate(0,-50%)' }}>
                  {cdUnit(cd.months, 'MESES')}
                  {cdUnit(cd.days, 'DIAS')}
                </div>
                <div className={`${s.cd} ${s.cdB}`} data-fade ref={r.cdB} style={{ transform: identity.split === 'h' ? undefined : 'translate(0,-50%)' }}>
                  {cdUnit(cd.hours, 'HORAS')}
                  {cdUnit(cd.minutes, 'MIN')}
                </div>
              </>
            ) : (
              <div className={s.big} data-fade>
                <span className="mono" style={{ fontSize: 13, letterSpacing: '.22em', color: 'var(--mute)' }}>{dest.toUpperCase()}</span>
                <b>{phase.kind === 'today' ? 'É hoje.' : phase.kind === 'during' ? `Dia ${phase.day} de ${phase.total}` : `Há ${phase.daysAgo} dias você voltou.`}</b>
              </div>
            )}
          </div>
          <div className={s.badge} data-fade aria-hidden="true">
            <svg viewBox="0 0 132 132" width="132" height="132">
              <defs>
                <path id={`circ-${uid}`} d="M66 66 m-52 0 a52 52 0 1 1 104 0 a52 52 0 1 1 -104 0" />
              </defs>
              <text fontFamily="var(--font-mono)" fontSize="10.5" letterSpacing="3" fill="currentColor">
                <textPath href={`#circ-${uid}`}>{`TRILHA · IDENTIDADE ${identity.idName} · GERADA PARA ${dest} · `.toUpperCase()}</textPath>
              </text>
            </svg>
            <i />
          </div>
          <div className={`${s.hint} mono`} ref={r.hint} aria-hidden="true">
            <span>ROLE PARA ABRIR</span>
            <span />
          </div>
        </div>
      </section>

      {stops.length ? (
        <section className={s.route} ref={r.route} aria-label="A rota">
          <div className={s.stage}>
            <div className={s.routePat}>
              <Pattern identity={identity} />
            </div>
            <div className={s.routeInfo}>
              <span className="eyebrow" style={{ color: 'inherit', opacity: 0.8 }}>
                A rota · parada <span ref={r.rNum}>1</span> de {stops.length}
              </span>
              <h2 className="disp" ref={r.rCity}>{stops[0].name}</h2>
              <div style={{ fontSize: 17, opacity: 0.85 }} ref={r.rMeta}>{[stops[0].country, stopMeta(stops[0])].filter(Boolean).join(' · ')}</div>
              <div className="mono" style={{ display: 'flex', gap: 18, fontSize: 14 }}>
                <span ref={r.rDates}>{stopDates(stops[0])}</span>
                <span ref={r.rNights}>{stopNights(stops[0])}</span>
              </div>
              <div className={s.segs}>
                {stops.map((st) => (
                  <span key={st.id} />
                ))}
              </div>
              <div className={s.routeTip} ref={r.rTip} style={{ display: tips[0] ? '' : 'none' }}>
                <span className="tag mono" data-tip-tag>{tips[0]?.by === 'ai' ? 'IA' : 'AUTO'}</span>
                <span data-tip-text>{tips[0]?.text}</span>
              </div>
              <div className="mono" style={{ fontSize: 13, opacity: 0.8 }} ref={r.rLeg}>
                {legToNext(b, stops, 0) ? `PRÓXIMO TRECHO · ${legToNext(b, stops, 0)}` : ''}
              </div>
              {reduced ? (
                <ol style={{ margin: 0, paddingLeft: 18 }}>
                  {stops.map((st) => (
                    <li key={st.id}>{st.name} · {stopDates(st)}</li>
                  ))}
                </ol>
              ) : null}
            </div>
            <div className={s.routeMap}>
              <svg role="img" aria-label={`Mapa da rota: ${stops.map((x) => x.name).join(', ')}`} viewBox="0 0 800 500">
                <path d={routeD} fill="none" stroke="var(--on-deep)" strokeOpacity=".25" strokeWidth="2" strokeDasharray="4 8" />
                <path ref={r.rPath} d={routeD} fill="none" stroke="var(--route)" strokeWidth="4" strokeLinecap="round" pathLength={1} strokeDasharray="1 1" strokeDashoffset={reduced ? 0 : 1} />
                {geo.pts.map((p, i) => (
                  <g key={stops[i].id} data-rs style={{ opacity: reduced ? 1 : 0.35, transition: 'opacity .4s' }}>
                    <circle cx={p[0]} cy={p[1]} r="7" fill={reduced ? 'var(--route)' : 'var(--deep)'} stroke="var(--route)" strokeWidth="2.5" />
                    <text x={p[0]} y={i % 2 ? p[1] - 26 : p[1] + 42} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="15" letterSpacing="2" fill="var(--on-deep)">
                      {stopCode(stops[i])}
                    </text>
                  </g>
                ))}
              </svg>
              <span className={s.mapNote}>ROTA ILUSTRATIVA · O MAPA REAL FICA NO ROTEIRO</span>
            </div>
          </div>
        </section>
      ) : (
        <section className={s.routeEmpty} aria-label="A rota">
          <span className="eyebrow" style={{ color: 'inherit', opacity: 0.8 }}>A rota</span>
          <h2 className="disp" style={{ margin: 0, fontSize: 'clamp(40px,6vw,88px)', lineHeight: 0.95 }}>Nenhuma parada ainda.</h2>
          <p style={{ margin: 0, fontSize: 18, maxWidth: 520 }}>Adicione a primeira cidade e a linha da rota começa a se desenhar aqui.</p>
          {canEdit ? (
            <Link className="btn btn-primary tap" href={`${base}/roteiro#nova`}>
              <Icon name="plus" size={18} />
              Adicionar a primeira parada
            </Link>
          ) : null}
        </section>
      )}

      {stops.length ? (
        <div className={s.marqueeWrap}>
          <Marquee words={stops.map((x) => x.name.toUpperCase())} />
        </div>
      ) : null}

      <section className={s.numbers} ref={r.nums} aria-label="A viagem em números">
        {!reduced ? <Floaters spots={pointsFloat} /> : null}
        <span className="eyebrow" style={{ position: 'relative' }}>A viagem em números</span>
        <div className={s.stats}>
          {stats.map((x, i) => (
            <div key={x.label} className={s.stat} data-stat data-v={x.v} data-pre={x.pre} data-suf={x.suf} style={{ ['--c' as string]: cols[i % 4] }}>
              <b>{reduced ? `${x.pre}${x.v.toLocaleString('pt-BR')}${x.suf}` : '0'}</b>
              <span>{x.label}</span>
            </div>
          ))}
        </div>
        <span className="sr">
          {stats.map((x) => `${x.pre}${x.v.toLocaleString('pt-BR')}${x.suf} ${x.label}`).join('; ')}
        </span>
      </section>

      <section className={s.pending} id="pendencias" ref={r.pend} aria-label="Antes de embarcar">
        {!reduced ? <Floaters spots={pendFloat} /> : null}
        <span className="eyebrow" style={{ position: 'relative' }}>{phase.kind === 'after' ? 'Fechando a viagem' : 'Antes de embarcar'}</span>
        <ul>
          {rows.length ? (
            rows.map((row, i) => (
              <li key={row.key} style={{ opacity: reduced ? 1 : 0 }}>
                <span aria-hidden="true" className="bullet" style={{ width: 14, height: 14, background: cols[i % 4] }} />
                <div style={{ flex: '1 1 280px' }}>
                  <div className={s.t}>
                    {row.title}
                    {row.by ? <AiTag by={row.by} /> : null}
                  </div>
                  {row.detail ? <div className={s.s}>{row.detail}</div> : null}
                </div>
                <Link className={s.go} href={row.href}>
                  {row.cta}
                  <Icon name="arrow" size={16} />
                </Link>
              </li>
            ))
          ) : (
            <li style={{ opacity: reduced ? 1 : 0 }}>
              <span aria-hidden="true" className="bullet" style={{ width: 14, height: 14, background: cols[0] }} />
              <div className={s.t}>Tudo em dia por aqui. Nenhuma pendência aberta.</div>
            </li>
          )}
        </ul>
      </section>

      <section className={s.final} ref={r.fin} aria-label="Fim">
        <div style={{ position: 'absolute', inset: 0, opacity: 0.14 }}>
          <Pattern identity={identity} />
        </div>
        <h2 className="disp" ref={r.fTitle} style={{ opacity: reduced ? 1 : 0 }}>
          {phase.kind === 'before' ? (
            <>
              Faltam
              <br />
              {days} {days === 1 ? 'dia' : 'dias'}.
            </>
          ) : phase.kind === 'today' ? (
            'É hoje.'
          ) : phase.kind === 'during' ? (
            <>
              Dia {phase.day}
              <br />
              de {phase.total}.
            </>
          ) : (
            <>
              Que
              <br />
              viagem.
            </>
          )}
        </h2>
        <div className="actions" ref={r.fAct} style={{ position: 'relative', justifyContent: 'center', opacity: reduced ? 1 : 0 }}>
          <Link className="btn tap" style={{ background: 'var(--fg-acc)', color: 'var(--acc)', borderColor: 'transparent' }} href={phase.kind === 'after' ? `${base}/diario?momento=depois` : `${base}/roteiro`}>
            {phase.kind === 'after' ? 'Abrir a retrospectiva' : 'Abrir roteiro completo'}
            <Icon name="arrow" size={18} />
          </Link>
          <a className="btn btn-ghost tap" style={{ color: 'inherit', borderColor: 'currentColor', background: 'transparent' }} href="#pendencias">
            Ver pendências
          </a>
        </div>
      </section>
    </div>
  );
}
