'use client';
// Passo 5 do onboarding como baralho (planning §10.7): um passeio por vez, "quero" ou "pular",
// arrastando a carta ou pelos botões/setas. As cartas de cada cidade acabam e entram as da próxima.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { TourIdea } from '../data/types';
import { useActivityPhoto } from '../data/usePhoto';
import { Badge, EstimateBadge, GoogleLink, Icon, Photo, type PhotoData } from '../components/ui';
import { AI_STEPS, AiThinking } from '../components/ui/Loader';
import s from './montar.module.css';

export type Decision = 'yes' | 'no';
export interface DeckGroup {
  stop: { id: string; name: string; nights: number };
  /** undefined = ainda carregando */
  ideas?: TourIdea[];
}
interface Card { idea: TourIdea; stop: DeckGroup['stop']; index: number; of: number }

const SWIPE = 110;

function TourCard({ card, money, recommended, wish, drag, leaving }: {
  card: Card; money: (v: number) => string; recommended: boolean; wish: boolean; drag: number; leaving: Decision | null;
}) {
  const t = card.idea;
  const name = t.title.replace(/^Bate-volta: /, '');
  // O lugar do passeio (photo_query, ex.: "Murano") acha foto mais vezes que o título inteiro.
  const photo = useActivityPhoto([t.photo_query, name], card.stop.name);
  const price = Math.round((t.cost_low + t.cost_high) / 2);
  const hint = leaving ?? (drag > 40 ? 'yes' : drag < -40 ? 'no' : null);
  return (
    <>
      <Photo photo={photo as PhotoData | null} place={t.title} alt="" height="clamp(140px, 26vh, 200px)" caption={false} />
      <span className={s.stamp} data-show={hint === 'yes'} data-kind="yes" aria-hidden="true"><Icon name="heart" size={18} />Quero</span>
      <span className={s.stamp} data-show={hint === 'no'} data-kind="no" aria-hidden="true"><Icon name="close" size={18} />Pular</span>
      <div className={s.tourBody}>
        <span className={s.tourCity}><Icon name="pin" size={13} />{card.stop.name} · {card.index + 1} de {card.of}</span>
        <div className={s.tourHead}>
          <h3 className={s.tourTitle}>{t.title}</h3>
          <GoogleLink what={name} where={card.stop.name} />
        </div>
        <div className={s.chips}>
          {wish ? <span className={s.origin} data-tone="ok"><Icon name="heart" size={13} />Seu pedido: {t.wish}</span> : null}
          {recommended && !wish ? <span className={s.origin} data-tone="brand"><Icon name="sparkle" size={13} />A Trilha recomenda</span> : null}
          {t.duration ? <Badge>{t.duration}</Badge> : null}
        </div>
        {t.why ? <p className={s.why}>{t.why}</p> : null}
        <p className={s.tourPrice}>{t.cost_high === 0 ? 'Grátis' : <>≈ {money(price)} <small>por pessoa</small> <EstimateBadge /></>}</p>
      </div>
    </>
  );
}

export function TourDeck({ groups, value, onChange, recommended, wishes, money, onAcceptRest }: {
  groups: DeckGroup[];
  value: Record<string, Decision>;
  onChange: (next: Record<string, Decision>) => void;
  recommended: Set<string>;
  wishes: string[];
  money: (v: number) => string;
  onAcceptRest: () => void;
}) {
  // Fila na ordem das cidades; só entram cidades já carregadas (as seguintes ainda chegando).
  const cards = useMemo(() => {
    const out: Card[] = [];
    for (const g of groups) {
      if (!g.ideas) break;
      g.ideas.forEach((idea, index) => out.push({ idea, stop: g.stop, index, of: g.ideas!.length }));
    }
    return out;
  }, [groups]);
  const loadingNext = groups.find((g) => !g.ideas) ?? null;
  const pending = cards.filter((c) => !value[c.idea.id]);
  const top = pending[0] ?? null;
  const [drag, setDrag] = useState(0);
  const [leaving, setLeaving] = useState<Decision | null>(null);
  const start = useRef<number | null>(null);
  const history = useRef<string[]>([]);
  const wishSet = new Set(wishes.map((w) => w.toLowerCase().trim()));
  const total = groups.reduce((a, g) => a + (g.ideas?.length ?? 0), 0);
  const done = Object.keys(value).length;
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const decide = (d: Decision) => {
    if (!top || leaving) return;
    setLeaving(d);
    const id = top.idea.id;
    window.setTimeout(() => {
      history.current.push(id);
      onChange({ ...value, [id]: d });
      setLeaving(null);
      setDrag(0);
    }, reduce ? 60 : 260);
  };
  const undo = () => {
    const id = history.current.pop();
    if (!id) return;
    const next = { ...value };
    delete next[id];
    onChange(next);
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /INPUT|TEXTAREA|SELECT/.test(el.tagName)) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); decide('yes'); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); decide('no'); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const style = (offset: number): React.CSSProperties => {
    if (offset === 0) {
      if (leaving) return { transform: `translateX(${leaving === 'yes' ? 130 : -130}%) rotate(${leaving === 'yes' ? 16 : -16}deg)`, opacity: 0 };
      return { transform: `translateX(${drag}px) rotate(${drag / 18}deg)`, transition: start.current != null ? 'none' : undefined };
    }
    return { transform: `translateY(${offset * 12}px) scale(${1 - offset * 0.04})`, opacity: offset > 2 ? 0 : 1 };
  };

  return (
    <div className={s.deckWrap}>
      <div className={s.deckProgress} aria-live="polite">
        <span>{top ? `Passeio ${done + 1} de ${total}${loadingNext ? '+' : ''}` : loadingNext ? `Buscando passeios em ${loadingNext.stop.name}…` : `Você decidiu os ${total} passeios`}</span>
        <div className={s.deckDots} aria-hidden="true">
          {groups.map((g) => {
            const ids = g.ideas?.map((i) => i.id) ?? [];
            const n = ids.filter((id) => value[id]).length;
            return <i key={g.stop.id} title={g.stop.name} data-state={!g.ideas ? 'loading' : n === ids.length ? 'done' : n ? 'doing' : 'todo'} />;
          })}
        </div>
      </div>

      <div className={s.deck} data-testid="tour-deck">
        {top ? pending.slice(0, 3).map((c, offset) => (
          <article
            key={c.idea.id}
            className={s.tourCard}
            data-top={offset === 0}
            data-tour={c.idea.title}
            style={{ ...style(offset), zIndex: 10 - offset }}
            aria-hidden={offset > 0}
            onPointerDown={offset === 0 ? (e) => { start.current = e.clientX; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } : undefined}
            onPointerMove={offset === 0 ? (e) => { if (start.current != null) setDrag(e.clientX - start.current); } : undefined}
            onPointerUp={offset === 0 ? () => { const d = drag; start.current = null; if (d > SWIPE) decide('yes'); else if (d < -SWIPE) decide('no'); else setDrag(0); } : undefined}
            onPointerCancel={offset === 0 ? () => { start.current = null; setDrag(0); } : undefined}
          >
            {offset < 2 ? <TourCard card={c} money={money} recommended={recommended.has(c.idea.id)} wish={!!c.idea.wish && wishSet.has(c.idea.wish.toLowerCase().trim())} drag={offset === 0 ? drag : 0} leaving={offset === 0 ? leaving : null} /> : null}
          </article>
        )) : loadingNext ? (
          <div className={s.tourCard} data-top="true" aria-busy="true"><div className={s.tourBody}><AiThinking steps={AI_STEPS.tours} title={`Passeios em ${loadingNext.stop.name}`} lines={2} compact /></div></div>
        ) : (
          <div className={s.deckEmpty}><Icon name="check" size={28} /><b>Acabaram as cartas</b><span>Confira abaixo o que entrou e mude o que quiser.</span></div>
        )}
      </div>

      {top ? (
        <div className={s.deckButtons}>
          <button type="button" className={s.deckBtn} data-kind="no" onClick={() => decide('no')} aria-label={`Pular ${top.idea.title}`}><Icon name="close" size={26} /></button>
          <button type="button" className={s.deckUndo} onClick={undo} disabled={!history.current.length}>Desfazer</button>
          <button type="button" className={s.deckBtn} data-kind="yes" onClick={() => decide('yes')} aria-label={`Quero ${top.idea.title}`}><Icon name="heart" size={26} /></button>
        </div>
      ) : null}
      {top ? <button type="button" className={s.skip} onClick={onAcceptRest}>Aceitar as recomendações da Trilha para o resto</button> : null}
      <p className={s.muted} style={{ textAlign: 'center' }}>Arraste a carta para a direita (quero) ou para a esquerda (pular). No teclado, use as setas.</p>
    </div>
  );
}

/** Resumo depois do baralho: o que entrou em cada cidade; tocar troca a decisão. */
export function DeckSummary({ groups, value, onChange, money }: { groups: DeckGroup[]; value: Record<string, Decision>; onChange: (next: Record<string, Decision>) => void; money: (v: number) => string }) {
  return (
    <div className={s.stack}>
      {groups.map((g) => (
        <section key={g.stop.id} className={s.city} aria-label={`Passeios em ${g.stop.name}`}>
          <h3>{g.stop.name} · {g.stop.nights} noite{g.stop.nights === 1 ? '' : 's'}</h3>
          {!g.ideas?.length ? <p className={s.muted}>Sem sugestões aqui.</p> : (
            <div className={s.chips}>
              {g.ideas.map((t) => {
                const on = value[t.id] === 'yes';
                return (
                  <button key={t.id} type="button" className={s.pickChip} aria-pressed={on} onClick={() => onChange({ ...value, [t.id]: on ? 'no' : 'yes' })}>
                    <Icon name={on ? 'check' : 'plus'} size={14} />{t.title}{t.cost_high ? <small>≈ {money(Math.round((t.cost_low + t.cost_high) / 2))}</small> : <small>grátis</small>}
                  </button>
                );
              })}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
