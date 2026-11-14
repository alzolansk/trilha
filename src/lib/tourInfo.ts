// Contexto do passeio (canvas "cidade e reservas", fase 1): o que é, selo de leitura rápida e o
// que vale saber. Regras puras, sem rede e sem React. Mesmo princípio de placeDetail.ts: a janela
// encolhe em vez de inventar. Selo só com motivo; "combina com vocês" só quando a turma contou gostos.
import type { SuggestionPayload, TourTag } from '../data/types';

export const TOUR_TAGS: TourTag[] = ['classico', 'achadinho', 'combina'];
export const TOUR_TAG_LABEL: Record<TourTag, string> = { classico: 'Clássico', achadinho: 'Achadinho', combina: 'Combina com vocês' };

const clip = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function list(v: unknown, max: number, each: number, skip: string | null = null): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const t = clip(x, each);
    if (t.length >= 6 && (!skip || fold(t) !== fold(skip)) && !out.some((y) => fold(y) === fold(t))) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

export interface TourExtras {
  what: string | null;
  tag: TourTag | null;
  tag_reason: string | null;
  why_go: string[];
  caveats: string[];
  booking_hint: string | null;
}

/**
 * Lê os campos de contexto que a IA mandou (ou que estão gravados no payload) com segurança.
 * Sem motivo, o selo cai. "Combina" sem preferências da turma também cai: não dá pra dizer que
 * combina com quem não contou nada.
 */
export function parseTourExtras(raw: unknown, opts: { hasPreferences?: boolean } = {}): TourExtras {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const what = clip(o.what, 180) || null;
  const reason = clip(o.tag_reason, 140) || null;
  let tag: TourTag | null = TOUR_TAGS.includes(o.tag as TourTag) ? (o.tag as TourTag) : null;
  if (!reason) tag = null;
  if (tag === 'combina' && opts.hasPreferences === false) tag = null;
  const whyGo = list(o.why_go, 3, 200, what);
  return {
    what,
    tag,
    tag_reason: tag ? reason : null,
    why_go: whyGo,
    caveats: list(o.caveats, 3, 160),
    booking_hint: clip(o.booking_hint, 120) || null,
  };
}

/**
 * A frase "o que é" do card. Prefere `what`; senão usa o `why` antigo (sugestões de antes da fase 1),
 * que já diz algo do lugar. Nunca devolve só o título repetido.
 */
export function tourWhat(p: Pick<SuggestionPayload, 'title' | 'what' | 'why'> | null | undefined): string | null {
  if (!p) return null;
  for (const c of [p.what, p.why]) {
    const t = clip(c, 200);
    if (t && fold(t) !== fold(p.title ?? '')) return t;
  }
  return null;
}

/** Selo exibível: só quando há motivo gravado junto. */
export function tourTag(p: Pick<SuggestionPayload, 'tag' | 'tag_reason'> | null | undefined): { tag: TourTag; label: string; reason: string } | null {
  if (!p?.tag || !TOUR_TAGS.includes(p.tag) || !clip(p.tag_reason, 140)) return null;
  return { tag: p.tag, label: TOUR_TAG_LABEL[p.tag], reason: clip(p.tag_reason, 140) };
}

/** "Por que vale": os motivos gravados; sem eles, o `why` quando ele não é a mesma frase do "o que é". */
export function tourWhyGo(p: Pick<SuggestionPayload, 'title' | 'what' | 'why' | 'why_go'> | null | undefined): string[] {
  if (!p) return [];
  const listed = list(p.why_go, 3, 200);
  if (listed.length) return listed;
  const what = tourWhat(p);
  const why = clip(p.why, 200);
  return why && (!what || fold(why) !== fold(what)) ? [why] : [];
}
