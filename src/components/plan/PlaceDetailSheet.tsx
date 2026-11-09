'use client';
// Janela do lugar (design "Pop-up de destino sugerido", 08/11/2026). Responde "por que eu escolheria esse lugar?":
// resumo, por que vale, por que combina com vocês (ou para quem é), ressalvas, tempo explicado pelo tipo,
// destaques práticos, uma visita ilustrativa com minimapa e, recolhido, o que pesa antes de escolher.
// A escolha fica fixa no rodapé (vem de quem usa, em `footer`). Sem base para um bloco, o bloco não aparece.
import { useState } from 'react';
import type { PlaceDetail, PlaceHighlight, PlaceType, TravelProfile } from '../../data/types';
import { PHOTO_RADIUS, usePlacePhoto } from '../../data/usePhoto';
import { miniMap, placeLocation, PLACE_TYPE_LABEL, spanLabel, takesNights, timeUnitLabel } from '../../lib/placeDetail';
import { Busy } from '../ui/Loader';
import { Button, EstimateBadge, GoogleLink, Icon, Photo, Sheet, type PhotoData } from '../ui';
import type { IconName } from '../ui/icons.data';
import s from './placeDetail.module.css';

/** O que já se sabe do lugar antes do detalhe chegar (vem da lista do passo 3, da rota ou do cache). */
export interface PlaceBase {
  name: string;
  type?: PlaceType | null;
  parent?: string | null;
  region?: string | null;
  country?: string | null;
  lat?: number | null;
  lng?: number | null;
  /** descrição curta do lugar */
  why?: string | null;
  /** uma frase de por que combina (da lista) */
  fit?: string | null;
  /** tempo já conhecido ("2 a 3 noites", "bate-volta") */
  time?: string | null;
  /** o que ver, da lista (aparece enquanto o detalhe não chega ou se ele falhar) */
  attractions?: { name: string; why?: string | null }[];
  /** dica prática da lista */
  tip?: string | null;
}

const TYPE_ICON: Record<PlaceType, IconName> = { cidade: 'city', regiao: 'route', bairro: 'quarter', atracao: 'pin', experiencia: 'sparkle' };
const COST_LABEL = { gratis: 'Gratuito', pago: 'Pago', varia: 'Preço varia' } as const;

export function TypeChip({ type }: { type: PlaceType }) {
  return <span className={s.typeChip} data-type={type}><Icon name={TYPE_ICON[type]} size={13} />{PLACE_TYPE_LABEL[type]}</span>;
}

export function PlaceDetailSheet({
  open, onClose, base, detail, loading, failed, onRetry, profile, onTellUs, money, footer, children, facts,
}: {
  open: boolean;
  onClose: () => void;
  base: PlaceBase;
  detail: PlaceDetail | null;
  loading: boolean;
  failed?: boolean;
  onRetry?: () => void;
  profile?: TravelProfile | null;
  /** leva ao passo 2 para contar como imaginam a viagem (estado "para quem é") */
  onTellUs?: () => void;
  /** centavos → texto na moeda da trilha */
  money: (cents: number) => string;
  footer?: React.ReactNode;
  /** blocos do contexto (desejo encaixado, bate-voltas, por que ficou de fora) */
  children?: React.ReactNode;
  /** selos extras do contexto (parada 2, datas) */
  facts?: React.ReactNode;
}) {
  const d = detail;
  const type: PlaceType = d?.type ?? base.type ?? 'cidade';
  const name = d?.name ?? base.name;
  const parent = d?.parent ?? base.parent ?? null;
  const location = placeLocation({ type, parent, region: d?.region ?? base.region, country: d?.country ?? base.country });
  const lat = d?.lat ?? base.lat ?? null;
  const lng = d?.lng ?? base.lng ?? null;
  const context = type === 'bairro' || type === 'atracao' ? parent ?? base.country ?? null : d?.country ?? base.country ?? null;
  const { photo, loading: photoLoading } = usePlacePhoto(open ? { name, context, lat, lng, radiusKm: PHOTO_RADIUS[type] } : null, open);
  const waiting = loading && !d;
  const why = d?.why_go.length ? d.why_go : base.why ? [base.why] : [];
  const quick = [
    { label: timeUnitLabel(type).replace(' · em noites', '').replace(' · em horas ou turnos', ''), value: d?.time.label ?? base.time ?? null, icon: 'clock' as IconName },
    { label: 'Melhor momento', value: d?.best_moment ?? null, icon: 'sun' as IconName },
    { label: 'Como circular', value: d?.getting_around ?? null, icon: 'route' as IconName },
  ].filter((x) => x.value);

  return (
    <Sheet open={open} onClose={onClose} title={name} description={location || undefined} size="lg" footer={footer}>
      <div className={s.body} data-testid="place-detail">
        <div className={s.chips}>
          <TypeChip type={type} />
          {d?.time.stay_base ? <span className={s.okChip}><Icon name="bed" size={13} />Boa base para se hospedar</span> : null}
          {facts}
        </div>

        {photo ? (
          <Photo photo={photo as PhotoData} place={name} alt={`Foto de ${name}`} height={200} caption={false} />
        ) : photoLoading ? <div className={`skel ${s.photoSkel}`} aria-hidden="true" /> : null}

        {quick.length ? (
          <div className={s.quick}>
            {quick.map((q) => (
              <div key={q.label} className={s.tile}>
                <span className={s.tileLabel}><Icon name={q.icon} size={13} />{q.label}</span>
                <b>{q.value}</b>
              </div>
            ))}
          </div>
        ) : null}

        {d?.summary ? <p className={s.lead}>{d.summary}</p> : null}

        {why.length ? (
          <section className={s.section} aria-labelledby="pd-why">
            <h3 id="pd-why" className={s.h}>Por que vale conhecer</h3>
            {why.map((p) => <p key={p.slice(0, 32)} className={s.p}>{p}</p>)}
          </section>
        ) : null}

        {!d && base.attractions?.length ? (
          <section className={s.section} aria-labelledby="pd-see">
            <h3 id="pd-see" className={s.h}>O que ver</h3>
            <ol className={s.hlList}>
              {base.attractions.map((a, i) => (
                <li key={a.name} className={s.hl}>
                  <span className={s.hlNum}>{i + 1}</span>
                  <div className={s.hlBody}><b className={s.hlName}>{a.name}</b>{a.why ? <p className={s.p}>{a.why}</p> : null}</div>
                </li>
              ))}
            </ol>
            {base.tip ? <p className={s.small}>{base.tip}</p> : null}
          </section>
        ) : null}
        {waiting ? <DetailSkeleton /> : null}
        {failed && !d ? (
          <div className={s.note} role="status">
            <span>Não deu pra carregar os detalhes agora.</span>
            {onRetry ? <Button size="sm" variant="secondary" onClick={onRetry}>Tentar de novo</Button> : null}
          </div>
        ) : null}

        <FitBlock detail={d} base={base} profile={profile} onTellUs={onTellUs} />

        {d && d.time.options.length ? (
          <section className={s.section} aria-labelledby="pd-time">
            <h3 id="pd-time" className={s.h}>Quanto tempo dedicar</h3>
            <div className={s.timeGrid} style={{ gridTemplateColumns: `repeat(${d.time.options.length}, minmax(0, 1fr))` }}>
              {d.time.options.map((o) => (
                <div key={o.label} className={s.timeOpt} data-suggested={o.suggested ? 'true' : undefined}>
                  <b>{o.label}{o.suggested ? <span className={s.suggested}>Sugerido</span> : null}</b>
                  <span>{o.text}</span>
                </div>
              ))}
            </div>
            {d.time.why ? <p className={s.p}><b>Por que esse tempo:</b> {d.time.why}</p> : null}
            {!takesNights(type) ? <p className={s.small}>Não pede noite própria: entra nos dias de {parent ?? 'uma cidade'}.</p> : null}
          </section>
        ) : null}

        {d && d.highlights.length ? <Highlights detail={d} place={name} open={open} /> : null}

        {d && d.visit.length ? <Visit detail={d} /> : null}

        {children}

        {d ? <BeforeChoosing detail={d} money={money} /> : null}

        <p className={s.small}>
          Sugestão da Trilha{profile ? ' com base no que vocês contaram' : ''}. Valores são estimativas de conhecimento geral; horários, preços e agenda mudam: confiram antes de ir.
        </p>
      </div>
    </Sheet>
  );
}

function DetailSkeleton() {
  return (
    <div className={s.section} role="status" aria-live="polite">
      <p className={s.small}><Busy>A Trilha está escrevendo por que esse lugar combina com vocês</Busy></p>
      <div className={`skel ${s.skelBlock}`} style={{ height: 120 }} />
      <div className={`skel ${s.skelBlock}`} style={{ height: 72 }} />
      <div className={`skel ${s.skelBlock}`} style={{ height: 180 }} />
    </div>
  );
}

/** "Por que combina com vocês" (só com o que a turma contou) ou "Para quem é"; ressalvas sempre que houver. */
function FitBlock({ detail: d, base, profile, onTellUs }: { detail: PlaceDetail | null; base: PlaceBase; profile?: TravelProfile | null; onTellUs?: () => void }) {
  const fit = d?.fit ?? [];
  const caveats = d?.caveats ?? [];
  if (!fit.length && !base.fit && !d?.for_whom && !caveats.length) return null;
  if (fit.length || (!d && base.fit)) {
    return (
      <section className={s.fit} aria-labelledby="pd-fit">
        <div className={s.fitHead}>
          <h3 id="pd-fit" className={s.h}><Icon name="sparkle" size={17} />Por que combina com vocês</h3>
          {fit.length ? (
            <div className={s.told}>
              <span>Vocês contaram:</span>
              {fit.map((f) => <span key={f.trait} className={s.toldChip}>{f.trait}</span>)}
            </div>
          ) : null}
        </div>
        {fit.length ? (
          <ul className={s.fitList}>{fit.map((f) => <li key={f.trait}><b>{f.trait}</b><span>{f.text}</span></li>)}</ul>
        ) : <p className={s.p}>{base.fit}</p>}
        <Caveats items={caveats} />
      </section>
    );
  }
  return (
    <section className={s.forWhom} aria-labelledby="pd-whom">
      <h3 id="pd-whom" className={s.h}>Para quem é</h3>
      {d?.for_whom ? <p className={s.p}>{d.for_whom}</p> : null}
      <Caveats items={caveats} />
      {!profile && onTellUs ? (
        <div className={s.tell}>
          <span>Contem como imaginam a viagem e a Trilha explica o encaixe.</span>
          <Button size="sm" variant="secondary" onClick={onTellUs}>Contar como é a viagem</Button>
        </div>
      ) : null}
    </section>
  );
}

function Caveats({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div className={s.caveats}>
      <b><Icon name="alert" size={15} />Pode não valer a pena se…</b>
      <ul>{items.map((c) => <li key={c}>{c}</li>)}</ul>
    </div>
  );
}

function Highlights({ detail: d, place, open }: { detail: PlaceDetail; place: string; open: boolean }) {
  const map = miniMap(d.highlights, 260, 200);
  return (
    <section className={s.section} aria-labelledby="pd-hl">
      <div className={s.rowHead}>
        <h3 id="pd-hl" className={s.h}>Destaques</h3>
        {map ? <span className={s.small}>Números iguais aos do mapa</span> : null}
      </div>
      <ol className={s.hlList}>
        {d.highlights.map((h, i) => <HighlightRow key={h.name} h={h} n={i + 1} place={place} open={open} />)}
      </ol>
    </section>
  );
}

function HighlightRow({ h, n, place, open }: { h: PlaceHighlight; n: number; place: string; open: boolean }) {
  // Foto só para atração com nome e coordenadas, conferida pela distância; senão, o número (lista compacta).
  const want = open && h.scope === 'especifico' && h.lat != null && h.lng != null;
  const { photo } = usePlacePhoto(want ? { name: h.name, context: place, lat: h.lat, lng: h.lng, radiusKm: PHOTO_RADIUS.atracao } : null, want);
  return (
    <li className={s.hl}>
      {photo ? (
        <span className={s.hlThumb}><Photo photo={photo as PhotoData} place={h.name} alt="" height={56} caption={false} /><i className={s.hlNumOver}>{n}</i></span>
      ) : <span className={s.hlNum} data-scope={h.scope}>{n}</span>}
      <div className={s.hlBody}>
        <div className={s.hlTitle}>
          <b>{h.name}</b>
          <span className={s.scope} data-scope={h.scope}>{h.scope === 'amplo' ? 'Sugestão ampla' : 'Atração'}</span>
          {h.scope === 'especifico' ? <GoogleLink what={h.name} where={place} compact /> : null}
        </div>
        <p className={s.p}>{h.what}{h.why ? ` ${h.why}` : ''}</p>
        <div className={s.meta}>
          {h.duration ? <span><Icon name="clock" size={14} />{h.duration}</span> : null}
          {h.cost ? <span data-cost={h.cost}><Icon name="ticket" size={14} />{COST_LABEL[h.cost]}</span> : null}
          {h.booking ? <span><Icon name="cal" size={14} />{h.booking}</span> : null}
        </div>
      </div>
    </li>
  );
}

function Visit({ detail: d }: { detail: PlaceDetail }) {
  const map = miniMap(d.highlights, 260, 200);
  return (
    <section className={s.section} aria-labelledby="pd-visit">
      <div className={s.rowHead}>
        <h3 id="pd-visit" className={s.h}>Como seria uma visita</h3>
        <span className={s.small}>Ilustrativo · o roteiro vem depois</span>
      </div>
      <div className={s.visitGrid} data-map={map ? 'true' : undefined}>
        <ol className={s.timeline}>
          {d.visit.map((v, i) => (
            <li key={`${v.when}-${i}`} data-last={i === d.visit.length - 1 ? 'true' : undefined}>
              <span className={s.when}>{v.when}</span>
              <i aria-hidden="true" />
              <span className={s.step}><b>{v.text}</b>{v.refs.length ? <small className={s.refs}>{v.refs.length > 1 ? 'destaques' : 'destaque'} {v.refs.join(' e ')}</small> : null}</span>
            </li>
          ))}
        </ol>
        {map ? (
          <figure className={s.map}>
            <svg role="img" aria-label={`Mapa ilustrativo com ${map.pins.length} destaques de ${d.name}`} viewBox="0 0 260 200" width="100%" height="200">
              <rect width="260" height="200" rx="16" className={s.mapBg} />
              <g className={s.mapGrid}>
                <path d="M0 50H260M0 100H260M0 150H260M65 0V200M130 0V200M195 0V200" />
              </g>
              <path className={s.mapPath} d={map.pins.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ')} />
              {map.pins.map((p) => (
                <g key={p.n} className={s.pin} data-scope={p.scope}>
                  <circle cx={p.x} cy={p.y} r="12" />
                  <text x={p.x} y={p.y + 4} textAnchor="middle">{p.n}</text>
                </g>
              ))}
            </svg>
            <figcaption className={s.small}>{spanLabel(map.spanKm)}. Posições aproximadas.</figcaption>
          </figure>
        ) : null}
      </div>
    </section>
  );
}

/** Antes de escolher: recolhido por padrão (só "Como chegar" aberto), cada item só com base para ele. */
function BeforeChoosing({ detail: d, money }: { detail: PlaceDetail; money: (c: number) => string }) {
  const p = d.practical;
  const rows: { key: string; icon: IconName; title: string; hint: string; body: React.ReactNode }[] = [];
  if (p.getting_there) rows.push({ key: 'chegar', icon: 'pin', title: 'Como chegar e circular', hint: d.getting_around ?? '', body: <p className={s.p}>{p.getting_there}</p> });
  if (p.best_time) rows.push({ key: 'periodo', icon: 'cal', title: 'Melhor período', hint: d.best_moment ?? '', body: <p className={s.p}>{p.best_time}</p> });
  if (p.costs.length) {
    rows.push({
      key: 'custos', icon: 'wallet', title: 'Custos estimados', hint: `Em ${d.currency}`,
      body: (
        <>
          <dl className={s.costs}>
            {p.costs.map((c) => (
              <div key={c.item}>
                <dt>{c.item}</dt>
                <dd data-free={c.high <= 0 ? 'true' : undefined}>{c.high <= 0 ? 'Gratuito' : `${c.low === c.high ? money(c.high) : `${money(c.low)}–${money(c.high)}`} ${c.unit}`}</dd>
              </div>
            ))}
          </dl>
          <p className={s.small}><EstimateBadge /> {p.cost_note ? `${p.cost_note}. ` : ''}Faixas aproximadas, não cotação.</p>
        </>
      ),
    });
  }
  if (p.limits.length) rows.push({ key: 'limites', icon: 'info', title: 'Limitações', hint: `${p.limits.length} ponto${p.limits.length > 1 ? 's' : ''}`, body: <ul className={s.ul}>{p.limits.map((l) => <li key={l}>{l}</li>)}</ul> });
  if (!rows.length && !p.check_at) return null;
  return (
    <section className={s.section} aria-labelledby="pd-before">
      <h3 id="pd-before" className={s.h}>Antes de escolher</h3>
      <div className={s.accordion}>
        {rows.map(({ key, ...r }, i) => <Fold key={key} {...r} start={i === 0} />)}
      </div>
      {p.check_at ? (
        <p className={s.small}>Horários e agenda: confiram em <a href={`https://${p.check_at}`} target="_blank" rel="noopener noreferrer">{p.check_at}</a>.</p>
      ) : null}
    </section>
  );
}

function Fold({ icon, title, hint, body, start }: { icon: IconName; title: string; hint: string; body: React.ReactNode; start: boolean }) {
  const [open, setOpen] = useState(start);
  return (
    <div className={s.fold}>
      <button type="button" className={s.foldBtn} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name={icon} size={18} />
        <span className={s.foldTitle}>{title}</span>
        {hint ? <span className={s.foldHint}>{hint}</span> : null}
        <span className={s.chev} data-open={open ? 'true' : undefined}><Icon name="next" size={16} /></span>
      </button>
      {open ? <div className={s.foldBody}>{body}</div> : null}
    </div>
  );
}
