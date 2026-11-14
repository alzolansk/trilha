'use client';
// Passeio com contexto (canvas "cidade e reservas", fase 1): o card diz o que é e se é clássico,
// achadinho ou combina com a turma; tocar abre um painel de LEITURA (não um formulário) com
// por que vale, bom saber e a escolha do dia. Usado na Parada e nas sugestões do Roteiro.
import { useState } from 'react';
import { EstimateBadge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { useAction } from '../ui/feedback';
import { Photo, type PhotoData } from '../ui/Photo';
import { Sheet } from '../ui/Sheet';
import { acceptSuggestion, dismissSuggestion } from '../../data/suggestionActions';
import { useBundle } from '../../data/TripContext';
import type { PhotoRef, Stop, TourTag, TripBundle } from '../../data/types';
import { useResolvedPhoto } from '../../data/usePhoto';
import { activityCapForStop, fitOf } from '../../lib/explore';
import { dayWeekU } from '../../lib/format';
import { formatMoney } from '../../lib/money';
import type { Tour } from '../../lib/route';
import { stopSlots, type DaySlot } from '../../lib/suggestions';
import { TOUR_TAG_LABEL } from '../../lib/tourInfo';
import s from './tour.module.css';

const EFFORT: Record<string, string> = { leve: 'leve', moderado: 'moderado', puxado: 'puxado' };
const FIT: Record<string, string> = { manha: 'manhã', tarde: 'tarde', noite: 'noite', dia_todo: 'dia todo' };
const SLOT: Record<DaySlot['state'], string> = { vazio: 'livre', folga: 'com folga', cheio: 'cheio', aclimatar: 'aclimatar', viagem: 'viagem' };

export function costText(t: Pick<Tour, 'costLow' | 'costHigh' | 'currency'>): string | null {
  if (t.costHigh == null) return null;
  if (t.costHigh <= 0) return 'grátis';
  const mid = Math.round(((t.costLow ?? t.costHigh) + t.costHigh) / 2);
  return `≈ ${formatMoney(mid, t.currency, { compact: true })} por pessoa`;
}

export function tourMeta(t: Tour): string {
  return [t.duration, t.effort ? EFFORT[t.effort] ?? t.effort : null, costText(t)].filter(Boolean).join(' · ');
}

/** Passa do teto de passeios da parada? (só na moeda da trilha). */
function overCap(t: Tour, b: TripBundle, stop: Stop): number | null {
  if (t.costHigh == null || t.currency !== b.trip.base_currency) return null;
  const cap = activityCapForStop(b, stop);
  return fitOf(t.costLow ?? t.costHigh, t.costHigh, cap) === 'over' ? t.costHigh - cap : null;
}

export function TagPill({ tag, className }: { tag: TourTag; className?: string }) {
  return <span className={`${s.tag} ${s[`tag_${tag}`]} ${className ?? ''}`}>{TOUR_TAG_LABEL[tag]}</span>;
}

/** Foto do passeio: a gravada; senão busca e grava na atividade ou na sugestão (para a turma toda). */
export function useTourPhoto(t: Tour, stop: Stop, resolve: boolean): PhotoRef | null {
  const { source, reload } = useBundle();
  return useResolvedPhoto(t.photo, t.photoQuery, resolve, (p: PhotoRef) => {
    if (t.activity) void source.update('activities', t.activity.id, { photo: p }, t.activity.version).then(reload).catch(() => undefined);
    else if (t.suggestion) void source.update('suggestions', t.suggestion.id, { payload: { ...t.suggestion.payload, photo: p } }, t.suggestion.version).then(reload).catch(() => undefined);
  }, stop.name);
}

export function statusText(t: Tour): { text: string; tone: 'ok' | 'brand' | 'todo' } {
  if (t.status.kind === 'roteiro') return { text: `No dia ${t.status.day}`, tone: 'ok' };
  if (t.status.kind === 'votacao') return { text: t.status.pos ? `Em votação · ${t.status.pos} de ${t.status.total}` : 'Em votação', tone: 'brand' };
  return { text: t.status.slot ? `Cabe no dia ${t.status.slot.dayNumber}` : 'Sem dia ainda', tone: 'todo' };
}

/** Card do passeio: foto, selo, o que é, meta e onde ele está. O card inteiro abre o painel. */
export function TourCard({ t, stop, resolve, onOpen }: { t: Tour; stop: Stop; resolve: boolean; onOpen: () => void }) {
  const photo = useTourPhoto(t, stop, resolve);
  const st = statusText(t);
  const fans = t.fans.length ? `${t.fans.join(' e ')} ${t.fans.length === 1 ? 'quer' : 'querem'} muito` : null;
  return (
    <button type="button" className={s.card} onClick={onOpen} aria-label={`${t.title}: saber mais`}>
      <Photo photo={photo as PhotoData | null} place={t.photoQuery} alt="" height={168} radius="0" caption={false}>
        {t.tag ? <TagPill tag={t.tag} className={s.cardTag} /> : null}
      </Photo>
      <span className={s.cardBody}>
        <b className={s.cardTitle}>{t.title}</b>
        {t.what ? <span className={s.cardWhat}>{t.what}</span> : null}
        {fans ? <span className={s.cardFans}>{fans}</span> : null}
        <span className={s.cardMeta}>{tourMeta(t) || ' '}</span>
        <span className={s.cardFoot}>
          <span className={s[`st_${st.tone}`]}>{st.text}</span>
          <span className={s.more}>Saber mais</span>
        </span>
      </span>
    </button>
  );
}

/** Painel do passeio: o que é, por que vale, combina com vocês, bom saber e em qual dia. */
export function TourDetail({ t, stop, onClose }: { t: Tour; stop: Stop; onClose: () => void }) {
  const { bundle: b, source, reload, canEdit } = useBundle();
  const { run, busy } = useAction();
  const resolve = canEdit && source.kind !== 'demo';
  const photo = useTourPhoto(t, stop, resolve);
  const slots = stopSlots(b, stop).filter((x) => x.state !== 'viagem');
  const initial = t.status.kind === 'nova' ? t.status.slot?.date ?? null : null;
  const [day, setDay] = useState<string | null>(initial ?? slots.find((x) => x.state === 'vazio' || x.state === 'folga')?.date ?? slots[0]?.date ?? null);
  const sel = slots.find((x) => x.date === day) ?? null;
  const can = canEdit && t.status.kind === 'nova' && !!t.suggestion;
  const over = overCap(t, b, stop);
  const st = statusText(t);

  const choose = () =>
    run(async () => {
      if (!t.suggestion || !day) return;
      await acceptSuggestion(source, b, t.suggestion, day);
      await reload();
      onClose();
    }, { success: `${t.title} entrou no dia ${sel?.dayNumber ?? ''}.` });
  const dismiss = () =>
    run(async () => {
      if (!t.suggestion) return;
      await dismissSuggestion(source, t.suggestion);
      await reload();
      onClose();
    }, { success: 'Tudo bem, a Trilha tira essa ideia da lista.' });

  const facts = [
    t.duration ? { k: 'dura', v: t.duration } : null,
    t.effort ? { k: 'esforço', v: EFFORT[t.effort] ?? t.effort } : null,
    costText(t) ? { k: 'por pessoa', v: costText(t)!.replace(' por pessoa', '') } : null,
    t.dayFit ? { k: 'melhor', v: FIT[t.dayFit] ?? t.dayFit } : null,
  ].filter((x): x is { k: string; v: string } => !!x);
  const goodToKnow = [...t.caveats, ...(t.bookingHint ? [t.bookingHint] : [])];

  return (
    <Sheet
      open onClose={onClose} variant="panel" title={t.title}
      description={t.status.kind === 'nova' ? `Ideia para ${stop.name}` : st.text}
      hero={<Photo photo={photo as PhotoData | null} place={t.photoQuery} height={240} radius="0" />}
      footer={can ? (
        <>
          <Button variant="ghost" onClick={() => void dismiss()} disabled={busy}>Não é para nós</Button>
          <Button onClick={() => void choose()} disabled={busy || !day}>{sel ? `Pôr no dia ${sel.dayNumber}` : 'Pôr no roteiro'}</Button>
        </>
      ) : undefined}
    >
      <div className={s.detail}>
        {t.tag ? (
          <div className={s.tagRow}>
            <TagPill tag={t.tag} />
            {t.tag !== 'combina' && t.tagReason ? <span className={s.tagReason}>{t.tagReason}</span> : null}
          </div>
        ) : null}
        {t.what ? <p className={s.what}>{t.what}</p> : <p className={s.muted}>A Trilha ainda não tem um resumo deste passeio. Peça mais sugestões para ganhar contexto.</p>}

        {facts.length ? (
          <dl className={s.facts}>
            {facts.map((f) => <div key={f.k}><dt>{f.k}</dt><dd>{f.v}</dd></div>)}
          </dl>
        ) : null}

        {t.whyGo.length ? (
          <section className={s.block} aria-label="Por que vale">
            <h3>Por que vale</h3>
            <ul>{t.whyGo.map((x) => <li key={x}>{x}</li>)}</ul>
          </section>
        ) : null}

        {t.tag === 'combina' && t.tagReason ? (
          <section className={s.fit} aria-label="Combina com vocês">
            <h3>Combina com vocês</h3>
            <p>{t.tagReason[0].toUpperCase() + t.tagReason.slice(1)}.</p>
          </section>
        ) : null}

        {t.fans.length || t.savedBy ? (
          <p className={s.social}>{t.fans.length ? `${t.fans.join(' e ')} ${t.fans.length === 1 ? 'quer' : 'querem'} muito ir.` : `${t.savedBy} salvou no Diário.`}</p>
        ) : null}

        {goodToKnow.length || t.estimate || over ? (
          <section className={s.block} aria-label="Bom saber">
            <h3>Bom saber</h3>
            <ul>
              {goodToKnow.map((x) => <li key={x}>{x}</li>)}
              {over ? <li>Passa {formatMoney(over, b.trip.base_currency, { compact: true })} do teto de passeios por pessoa em {stop.name}.</li> : null}
            </ul>
            {t.estimate ? <p className={s.estimate}><EstimateBadge /> Valor por pessoa a partir de conhecimento geral, não de preço ao vivo.</p> : null}
          </section>
        ) : null}

        {can && slots.length ? (
          <section className={s.block} aria-labelledby="tour-day">
            <h3 id="tour-day">Em qual dia?</h3>
            <div role="radiogroup" aria-labelledby="tour-day" className={s.days}>
              {slots.map((x) => (
                <button key={x.date} type="button" role="radio" aria-checked={day === x.date} className={s.day} onClick={() => setDay(x.date)}>
                  <b>Dia {x.dayNumber}</b>
                  <span>{dayWeekU(x.date).toLowerCase()}</span>
                  <small>{x.count ? `${x.count} ${x.count === 1 ? 'coisa' : 'coisas'}` : SLOT[x.state]}{initial === x.date ? ' · sugerido' : ''}</small>
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </Sheet>
  );
}
