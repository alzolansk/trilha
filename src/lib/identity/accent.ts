// Trilha 2.0 (planning.md, decisão 1): a identidade por destino vira UMA cor de destaque.
// O app inteiro usa o visual fixo; cada trilha guarda só `accent`, usada na capa sem foto,
// no pino do mapa e em pequenos detalhes. Nunca usar `accent` como cor de texto sem `fgOn`.
import { contrast, fgOn, fixContrast } from './contrast';
import { matchDictionary } from './dictionary';

export { contrast, fgOn };

export const DEFAULT_ACCENT = '#2B3FF5';

/** Cor por destino do dicionário (demo e trilhas que casam com ele). */
export const DICTIONARY_ACCENT: Record<string, string> = {
  andes: '#C8452C',
  japao: '#C2272D',
  marrocos: '#1F5FA8',
  islandia: '#1F6F8B',
};

/** As 8 cores pré-aprovadas para escolher em Ajustes (todas passam 4.5:1 com texto branco). */
export const ACCENT_CHOICES: { hex: string; name: string }[] = [
  { hex: '#2B3FF5', name: 'Ultramar' },
  { hex: '#C8452C', name: 'Terracota' },
  { hex: '#B5246B', name: 'Magenta' },
  { hex: '#17614F', name: 'Floresta' },
  { hex: '#1F6F8B', name: 'Petróleo' },
  { hex: '#6A3FD1', name: 'Violeta' },
  { hex: '#A8501A', name: 'Canela' },
  { hex: '#0D1017', name: 'Tinta' },
];

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Garante contraste mínimo de 3:1 com branco (silhuetas do placeholder e pino do mapa).
 * Cores que não passam são escurecidas em OKLCH; sem solução, cai na padrão.
 */
export function safeAccent(hex: string | null | undefined): string {
  if (!hex || !HEX.test(hex)) return DEFAULT_ACCENT;
  return fixContrast(hex.toUpperCase(), '#FFFFFF', 3) ?? DEFAULT_ACCENT;
}

interface AccentSource {
  accent?: string | null;
  destinations?: string[] | null;
  identity?: { key?: string; palette?: { acc?: string } } | null;
}

/**
 * Accent da trilha. Ordem: `trips.accent` (coluna da Fase 3) → acento da identidade antiga
 * (trilhas criadas antes do redesign) → dicionário pelo destino → padrão.
 */
export function tripAccent(trip: AccentSource | null | undefined): string {
  if (!trip) return DEFAULT_ACCENT;
  if (trip.accent) return safeAccent(trip.accent);
  const key = trip.identity?.key;
  if (key && DICTIONARY_ACCENT[key]) return DICTIONARY_ACCENT[key];
  if (trip.identity?.palette?.acc) return safeAccent(trip.identity.palette.acc);
  const hit = trip.destinations?.length ? matchDictionary(trip.destinations.join(' ')) : null;
  return hit ? DICTIONARY_ACCENT[hit] : DEFAULT_ACCENT;
}

/** Ciclo para itens em sequência (paradas, categorias). Hex porque alguns usos chamam `fgOn`. */
export const CYCLE = ['#2B3FF5', '#FF6B3D', '#0F7A4A', '#0D1017'];

/** Cores fixas por pessoa (o "você" é sempre tangerina, ver Avatar). */
export const PERSON_COLORS = ['#FFD8A8', '#C7CEFF', '#BDEBD3', '#FFC7D6', '#D9C7FF', '#C9E8F5', '#F3E3A6', '#E3E6EB'];

/** Cor por categoria de documento: [fundo, texto]. */
export const DOC_CAT_VAR: Record<string, [string, string]> = {
  passagem: ['var(--brand-soft)', 'var(--brand-ink)'],
  identidade: ['var(--sun-soft)', 'var(--sun-ink)'],
  reserva: ['var(--ok-soft)', 'var(--ok-ink)'],
  ingresso: ['var(--ink)', 'var(--on-dark)'],
  seguro: ['var(--brand-soft)', 'var(--brand-ink)'],
  outro: ['var(--field)', 'var(--ink-2)'],
};
