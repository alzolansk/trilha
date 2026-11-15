// Fotos do Unsplash (ajuste de 14/11/2026): funções puras de URL, filtro de qualidade e conferência do lugar.
// Quem busca é o servidor (unsplash.server.ts, com a chave); aqui nada usa rede, para dar pra testar.
// Regra que vale desde a Wikipedia: nunca foto de outro lugar. A busca do Unsplash devolve fotos bonitas de qualquer
// lugar parecido; só aceitamos uma foto quando o texto dela cita o lugar ou quando as coordenadas dela batem.
import type { PhotoRef } from '../data/types';
import { distKm, fold, keyWords, withUtm } from './photos';

export const UNSPLASH_API = 'https://api.unsplash.com';

export interface UnsplashPhoto {
  id: string;
  width: number;
  height: number;
  color?: string | null;
  blur_hash?: string | null;
  description?: string | null;
  alt_description?: string | null;
  premium?: boolean | null;
  plus?: boolean | null;
  urls: { raw: string };
  user: { name?: string | null; username?: string; links: { html: string } };
  links: { html: string };
  /** só no detalhe da foto (GET /photos/:id) */
  location?: { name?: string | null; city?: string | null; country?: string | null; position?: { latitude?: number | null; longitude?: number | null } | null } | null;
  tags?: { title?: string | null }[] | null;
}

export interface UnsplashSearch {
  total?: number;
  results?: UnsplashPhoto[];
}

/** Busca de fotos em paisagem, com filtro de conteúdo alto. */
export function unsplashSearchUrl(query: string, perPage = 15): string {
  return `${UNSPLASH_API}/search/photos?${new URLSearchParams({ query, per_page: String(perPage), orientation: 'landscape', content_filter: 'high' })}`;
}
export const unsplashPhotoUrl = (id: string) => `${UNSPLASH_API}/photos/${encodeURIComponent(id)}`;
/** Aviso de "download" (a diretriz pede quando a foto é escolhida para uso). */
export const unsplashDownloadUrl = (id: string) => `${UNSPLASH_API}/photos/${encodeURIComponent(id)}/download`;
export const isUnsplashId = (id: string) => /^[A-Za-z0-9_-]{6,20}$/.test(id);

/** Larga o bastante para um hero em tela 2x, em paisagem e sem ser Unsplash+ (marca d'água, licença paga). */
export function isUsable(p: UnsplashPhoto): boolean {
  if (p.premium || p.plus) return false;
  if (!/^https:\/\/images\.unsplash\.com\//.test(p.urls?.raw ?? '')) return false;
  if (!(p.width >= 1600) || !(p.height > 0)) return false;
  return p.width >= p.height * 1.15;
}

/** Tudo que o Unsplash diz sobre a foto, sem acento e em minúsculas. */
export function textOf(p: UnsplashPhoto): string {
  const loc = p.location ?? {};
  return fold([p.description, p.alt_description, loc.name, loc.city, loc.country, ...(p.tags ?? []).map((t) => t.title)].filter(Boolean).join(' '));
}

/** O texto cita alguma das palavras/frases, inteiras? ("nara" não casa com "narareal"). */
export function mentions(text: string, words: string[]): boolean {
  const t = ` ${text} `;
  return words.map(fold).filter((w) => w.length >= 3).some((w) => t.includes(` ${w} `));
}

export interface PlaceNeed {
  /** nomes aceitos (português, inglês…); para passeio, as palavras próprias dele */
  names: string[];
  lat?: number | null;
  lng?: number | null;
  radiusKm?: number;
}

/**
 * A foto é do lugar? 'yes' quando as coordenadas dela estão no raio ou o texto cita o nome; 'no' quando as
 * coordenadas dela estão longe; 'unknown' quando não dá pra saber (o detalhe da foto pode ter mais informação).
 */
export function placeCheck(p: UnsplashPhoto, need: PlaceNeed): 'yes' | 'no' | 'unknown' {
  const pos = p.location?.position;
  const plat = pos?.latitude;
  const plng = pos?.longitude;
  const hasPos = plat != null && plng != null && !(plat === 0 && plng === 0);
  if (hasPos && need.lat != null && need.lng != null) {
    return distKm([need.lat, need.lng], [plat!, plng!]) <= Math.max(need.radiusKm ?? 40, 2) ? 'yes' : 'no';
  }
  return mentions(textOf(p), need.names) ? 'yes' : 'unknown';
}

/** PhotoRef pronto para gravar, com crédito e links (com UTM) que a diretriz do Unsplash pede. */
export function toPhotoRef(p: UnsplashPhoto): PhotoRef {
  const color = p.color && /^#[0-9a-f]{6}$/i.test(p.color) ? p.color.toUpperCase() : null;
  const blur = p.blur_hash && p.blur_hash.length <= 60 ? p.blur_hash : null;
  return {
    url: p.urls.raw,
    width: p.width,
    height: p.height,
    author: (p.user.name || p.user.username || '').slice(0, 120) || null,
    author_url: withUtm(p.user.links.html),
    license: 'Licença Unsplash',
    source_url: withUtm(p.links.html),
    provider: 'unsplash',
    provider_id: p.id,
    color,
    blur_hash: blur,
  };
}

/** Palavras que identificam o lugar: nome em cada língua (sem qualificador) ou, para passeio, as palavras próprias. */
export function needFor(ask: { kind: 'place'; names: string[] } | { kind: 'activity'; names: string[]; city: string }): string[] {
  if (ask.kind === 'activity') return keyWords(ask.names, ask.city);
  return [...new Set(ask.names.map((n) => n.replace(/\s*\(.*\)\s*$/, '').split(',')[0].trim()).filter((n) => n.length >= 3))];
}

/**
 * Escolhe a foto conferida. Primeiro uma foto cujo texto da busca já cita o lugar (sem custo extra); senão, abre o
 * detalhe das primeiras `maxDetails` fotos (que traz local e tags) e fica com a primeira que passa. Sem nenhuma, null.
 */
export async function pickVerified(results: UnsplashPhoto[], need: PlaceNeed, detail: (id: string) => Promise<UnsplashPhoto | null | undefined>, maxDetails = 3): Promise<UnsplashPhoto | null> {
  if (!need.names.length && (need.lat == null || need.lng == null)) return null;
  const usable = results.filter(isUsable);
  const direct = usable.find((p) => placeCheck(p, need) === 'yes');
  if (direct) return direct;
  for (const p of usable.slice(0, maxDetails)) {
    const d = await detail(p.id);
    if (!d) continue;
    // o detalhe às vezes vem sem as URLs da busca: completa com as da busca
    const full: UnsplashPhoto = { ...p, ...d, urls: d.urls?.raw ? d.urls : p.urls, user: d.user ?? p.user, links: d.links ?? p.links };
    if (isUsable(full) && placeCheck(full, need) === 'yes') return full;
  }
  return null;
}
