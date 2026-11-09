// Fotos da Wikipedia / Wikimedia Commons (planning §8.1). Funções puras de URL e de parse,
// testáveis sem rede; quem busca é /api/photos (servidor) e quem pede é fetchPhoto (navegador).
// Regra: nunca usar foto de outro lugar. Se a página achada não é do lugar pedido, não há foto.
import type { PhotoRef } from '../data/types';

export const WIKI_LANGS = ['pt', 'en'] as const;
export type WikiLang = (typeof WIKI_LANGS)[number];

/** User-Agent pedido pela política da Wikimedia: identifica o app, sem e-mail pessoal. */
export const WIKI_USER_AGENT = 'Trilha/2.0 (app de planejamento de viagens em grupo; https://github.com/alzolansk/trilha)';

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Hosts de imagem da Wikimedia. Desde 2026 as miniaturas vêm de thumb.wikimedia.org (antes, upload.wikimedia.org/…/thumb/…);
 * os dois continuam valendo. Sem aceitar o thumb, toda foto com miniatura era descartada.
 */
export const isWikimediaImage = (url: string) => /^https:\/\/(upload|thumb)\.wikimedia\.org\//.test(url);

/** Imagens que não são foto do lugar: brasões, bandeiras, mapas, logos, desenhos vetoriais. Colagem da cidade vale. */
export function isUnfitImage(fileName: string): boolean {
  return /\.(svg|gif)$/i.test(fileName)
    || /(flag|bandeira|bandera|coat[ _]of[ _]arms|bras[aã]o|escudo|emblem|logo|seal|selo|map|mapa|locator|location|localiza|icon)/i.test(fileName);
}

/**
 * A página encontrada é do lugar pedido? Compara a primeira parte da busca ("San Blas, Cusco" → "san blas")
 * com o título da página, sem acento e por palavras inteiras. "Romell Quioto" não serve para "Quioto".
 */
export function titleMatches(query: string, title: string): boolean {
  return matchLevel(query, title) > 0;
}

/**
 * Quão bem o título casa com a busca: 3 = igual, 2 = a busca contém o título ("Tóquio Shibuya" → "Shibuya"), 0 = não.
 * Título que só começa com o nome não vale: "Nara" não pode virar a foto de "Nara Leão".
 */
export function matchLevel(query: string, title: string): number {
  const q = fold(query.split(',')[0]);
  const t = fold(title.replace(/\s*\(.*\)\s*$/, ''));
  if (!q || !t) return 0;
  if (t === q) return 3;
  if (` ${q} `.includes(` ${t} `)) return 2;
  return 0;
}

const api = (lang: WikiLang, params: Record<string, string>) =>
  `https://${lang}.wikipedia.org/w/api.php?${new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', origin: '*', ...params })}`;

/** Busca até 5 páginas com a imagem principal (pageimages). `title` busca a página exata. */
export function searchUrl(lang: WikiLang, q: { q?: string; title?: string }): string {
  if (q.title) return api(lang, { redirects: '1', prop: 'pageimages', piprop: 'name', titles: q.title });
  return api(lang, { generator: 'search', gsrsearch: q.q ?? '', gsrlimit: '5', gsrnamespace: '0', prop: 'pageimages', piprop: 'name' });
}

/** Metadados do arquivo (Commons é repositório compartilhado: a Wikipedia responde por ele). */
export function imageInfoUrl(lang: WikiLang, fileName: string, width = 1280): string {
  return api(lang, {
    prop: 'imageinfo', titles: `File:${fileName}`, iiprop: 'url|size|extmetadata', iiurlwidth: String(width),
    iiextmetadatafilter: 'Artist|LicenseShortName|Credit',
  });
}

interface SearchJson {
  query?: { pages?: { title: string; index?: number; pageimage?: string; missing?: boolean }[] };
}

/** Escolhe o arquivo da primeira página (na ordem da busca) que é do lugar e tem foto aproveitável. */
export function pickPageImage(json: SearchJson, query: string): { title: string; file: string } | null {
  // Primeiro o título igual ao lugar, depois o contido na busca (a ordem da Wikipedia desempata).
  const pages = [...(json.query?.pages ?? [])]
    .filter((p) => !p.missing && p.pageimage && !isUnfitImage(p.pageimage))
    .map((p) => ({ p, level: matchLevel(query, p.title) }))
    .filter((x) => x.level > 0)
    .sort((a, b) => b.level - a.level || (a.p.index ?? 0) - (b.p.index ?? 0));
  const best = pages[0]?.p;
  return best ? { title: best.title, file: best.pageimage! } : null;
}

/** Tira HTML do campo Artist do Commons ("<a href=…>Fulano</a>" → "Fulano"). */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

interface ImageInfoJson {
  query?: {
    pages?: {
      imageinfo?: {
        url?: string; thumburl?: string; thumbwidth?: number; thumbheight?: number; width?: number; height?: number; descriptionurl?: string;
        extmetadata?: Record<string, { value?: string } | undefined>;
      }[];
    }[];
  };
}

/** Monta o PhotoRef com autor e licença. Sem licença conhecida, não usa (não dá pra creditar direito). */
export function parseImageInfo(json: ImageInfoJson): PhotoRef | null {
  const info = json.query?.pages?.[0]?.imageinfo?.[0];
  if (!info) return null;
  const url = info.thumburl ?? info.url;
  if (!url || !isWikimediaImage(url)) return null;
  const meta = info.extmetadata ?? {};
  const license = stripHtml(meta.LicenseShortName?.value ?? '');
  if (!license) return null;
  const author = stripHtml(meta.Artist?.value ?? '') || stripHtml(meta.Credit?.value ?? '') || null;
  return {
    url: url.split('?')[0],
    width: info.thumbwidth ?? info.width,
    height: info.thumbheight ?? info.height,
    author: author ? author.slice(0, 120) : null,
    license: license.slice(0, 60),
    source_url: info.descriptionurl ?? null,
  };
}

/** Texto do crédito: "Foto: Fulano · CC BY-SA 4.0 · Wikimedia Commons". */
export function photoCredit(p: PhotoRef | null | undefined): string | null {
  if (!p) return null;
  if (p.path && !p.url) return 'Foto da turma';
  return ['Foto: ' + (p.author || 'autor desconhecido'), p.license, 'Wikimedia Commons'].filter(Boolean).join(' · ');
}

/** Variante menor do thumb da Wikimedia (…/1200px-x.jpg → …/400px-x.jpg), para srcset. */
export function thumbAt(url: string, width: number): string {
  return url.replace(/\/(\d+)px-([^/]+)$/, `/${width}px-$2`);
}

/** Larguras do srcset: os "degraus" de miniatura que a Wikimedia serve (pedir 1200 devolve 1280). */
export const PHOTO_WIDTHS = [500, 960, 1280] as const;

/** srcset com as variantes do thumb da Wikimedia; null para qualquer outra origem (upload próprio, URL assinada). */
export function photoSrcSet(url: string, widths: readonly number[] = PHOTO_WIDTHS): string | null {
  if (!/^https:\/\/(upload|thumb)\.wikimedia\.org\/.+\/\d+px-[^/]+$/.test(url)) return null;
  return widths.map((w) => `${thumbAt(url, w)} ${w}w`).join(', ');
}

// ───────────── Busca no navegador (planning §10, ajuste de 08/11/2026) ─────────────
// A busca vai direto do navegador para a Wikipedia (a API aceita CORS com origin=*), e não mais pelo
// servidor: com ~15 fotos por tela, todas saindo do mesmo IP, a Wikimedia limitava (429) e o app mostrava
// placeholder. Fila de 3 por vez, nova tentativa em 429/erro de rede, e cache no aparelho.

const MAX_PARALLEL = 4;
let active = 0;
const waiting: (() => void)[] = [];
async function inQueue<T>(fn: () => Promise<T>): Promise<T> {
  while (active >= MAX_PARALLEL) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** JSON da API; `undefined` = falhou (limite, rede), `null` = respondeu sem dado útil. */
export async function wikiJson<T>(url: string, fetcher: typeof fetch = fetch, tries = 3): Promise<T | null | undefined> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetcher(url, { headers: { 'Api-User-Agent': WIKI_USER_AGENT } });
      if (r.status === 429 || r.status >= 500) { await sleep(500 * 2 ** i); continue; }
      if (!r.ok) return null;
      if (!(r.headers.get('content-type') ?? '').includes('json')) { await sleep(500 * 2 ** i); continue; }
      return (await r.json()) as T;
    } catch {
      await sleep(500 * 2 ** i);
    }
  }
  return undefined;
}

/** Uma busca numa língua: página do lugar → arquivo → licença. `undefined` = não deu pra saber (falha). */
export async function findPhoto(query: string, lang: WikiLang, fetcher: typeof fetch = fetch): Promise<PhotoRef | null | undefined> {
  const search = await wikiJson<Parameters<typeof pickPageImage>[0]>(searchUrl(lang, { q: query }), fetcher);
  if (search === undefined) return undefined;
  const hit = search ? pickPageImage(search, query) : null;
  if (!hit) return null;
  const info = await wikiJson<Parameters<typeof parseImageInfo>[0]>(imageInfoUrl(lang, hit.file), fetcher);
  if (info === undefined) return undefined;
  return info ? parseImageInfo(info) : null;
}

const CACHE_KEY = 'trilha.photos.v3';
const DAY = 24 * 60 * 60 * 1000;
type Cached = { p: PhotoRef | null; at: number };
const memory = new Map<string, Promise<PhotoRef | null>>();
function readCache(key: string): PhotoRef | null | undefined {
  try {
    const all = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as Record<string, Cached>;
    const hit = all[key];
    if (!hit) return undefined;
    // foto achada vale 30 dias; "sem foto" só 1 dia (a página pode ganhar foto)
    if (Date.now() - hit.at > (hit.p ? 30 * DAY : DAY)) return undefined;
    return hit.p;
  } catch {
    return undefined;
  }
}
function writeCache(key: string, p: PhotoRef | null) {
  try {
    const all = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as Record<string, Cached>;
    all[key] = { p, at: Date.now() };
    const keys = Object.keys(all);
    if (keys.length > 400) for (const k of keys.sort((a, b) => all[a].at - all[b].at).slice(0, keys.length - 400)) delete all[k];
    localStorage.setItem(CACHE_KEY, JSON.stringify(all));
  } catch {
    /* sem armazenamento: só não guarda */
  }
}

/**
 * Navegador: foto de um lugar. Tenta cada busca de `queries` em português e em inglês, na ordem, até achar.
 * null quando não há foto; o Photo mostra o placeholder. Falha passageira não é guardada como "sem foto".
 */
export async function fetchPhoto(q: string | string[], lang: WikiLang = 'pt', fetcher: typeof fetch = fetch): Promise<PhotoRef | null> {
  const queries = [...new Set((Array.isArray(q) ? q : [q]).map((x) => x.trim()).filter((x) => x.length >= 2))];
  if (!queries.length) return null;
  const key = `${lang}|${queries.join('|')}`;
  const cached = readCache(key);
  if (cached !== undefined) return cached;
  if (!memory.has(key)) {
    memory.set(key, inQueue(async () => {
      let failed = false;
      for (const query of queries) {
        for (const l of lang === 'pt' ? (['pt', 'en'] as const) : (['en', 'pt'] as const)) {
          const p = await findPhoto(query, l, fetcher);
          if (p) { writeCache(key, p); return p; }
          if (p === undefined) failed = true;
        }
      }
      if (!failed) writeCache(key, null);
      else memory.delete(key); // tenta de novo na próxima vez que a tela pedir
      return null;
    }));
  }
  return memory.get(key)!;
}

// ───────────── Foto de um lugar, conferida (ajuste de 09/11/2026) ─────────────
// Reclamação: fotos demoravam e vários lugares vinham com a MESMA foto (um bairro pegava a foto da cidade,
// porque a busca "Cambuí Campinas" casava com a página "Campinas"; e homônimos de outro estado passavam).
// Agora: o título precisa ser o nome do lugar (o qualificador entre parênteses pode diferir), a página
// precisa estar perto das coordenadas do lugar quando as duas têm coordenadas, e uma foto já mostrada para
// um lugar não aparece em outro. Sem foto conferida, não há foto (a tela encolhe em vez de enfeitar).

export interface PlacePhotoQuery {
  name: string;
  /** cidade, estado ou país (ajuda a busca; não precisa estar no título) */
  context?: string | null;
  lat?: number | null;
  lng?: number | null;
  /** distância máxima entre a página e o lugar: cidade ~40 km, bairro ~6 km, atração ~3 km */
  radiusKm?: number;
}

/** Nome do lugar sem qualificadores que a Wikipedia não usa ("Rua X e arredores" → "Rua X"). */
const bareName = (name: string) => fold(name.replace(/\s+e arredores$/i, '').replace(/\s*\(.*\)\s*$/, ''));

/**
 * O título é do lugar? Igual ao nome, ignorando o qualificador entre parênteses ("Cambuí (Campinas)") e um
 * complemento depois da vírgula ("Cambuí, Campinas"). "Campinas" não serve para "Cambuí"; "Nara Leão" não serve para "Nara".
 */
export function nameMatches(name: string, title: string): boolean {
  const n = bareName(name);
  const t = fold(title.replace(/\s*\(.*\)\s*$/, '').split(',')[0]);
  return !!n && n === t;
}

const R = 6371;
const rad = (d: number) => (d * Math.PI) / 180;
function distKm(a: [number, number], b: [number, number]): number {
  const h = Math.sin(rad(b[0] - a[0]) / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Busca com imagem principal e coordenadas de cada página, numa chamada só. */
export function placeSearchUrl(lang: WikiLang, q: string): string {
  return api(lang, {
    generator: 'search', gsrsearch: q, gsrlimit: '8', gsrnamespace: '0',
    prop: 'pageimages|coordinates', piprop: 'name', coprimary: 'primary', colimit: 'max',
  });
}

interface PlaceSearchJson {
  query?: { pages?: { title: string; index?: number; pageimage?: string; missing?: boolean; coordinates?: { lat: number; lon: number }[] }[] };
}

/**
 * Escolhe a página do lugar: título com o nome exato, foto aproveitável e, quando há coordenadas dos dois lados,
 * a até `radiusKm` do lugar (a mais perto ganha). Uma página sem coordenadas só vale quando a busca não tem
 * coordenadas ou quando ela é a única com o nome (evita o homônimo de outro estado).
 */
export function pickPlaceImage(json: PlaceSearchJson, q: PlacePhotoQuery): { title: string; file: string } | null {
  const here = q.lat != null && q.lng != null ? ([q.lat, q.lng] as [number, number]) : null;
  const radius = q.radiusKm ?? 40;
  const named = [...(json.query?.pages ?? [])].filter((p) => !p.missing && nameMatches(q.name, p.title));
  const withPhoto = named.filter((p) => p.pageimage && !isUnfitImage(p.pageimage));
  const scored = withPhoto
    .map((p) => {
      const c = p.coordinates?.[0];
      const d = here && c ? distKm(here, [c.lat, c.lon]) : null;
      return { p, d };
    })
    .filter((x) => {
      if (x.d != null) return x.d <= radius;
      if (!here) return true;
      // sem coordenadas na página: só se nenhuma outra página tem o mesmo nome (pode ser o homônimo)
      return named.length === 1;
    })
    .sort((a, b) => (a.d ?? 1e6) - (b.d ?? 1e6) || (a.p.index ?? 0) - (b.p.index ?? 0));
  const best = scored[0]?.p;
  return best ? { title: best.title, file: best.pageimage! } : null;
}

export async function findPlacePhoto(search: string, q: PlacePhotoQuery, lang: WikiLang, fetcher: typeof fetch = fetch): Promise<PhotoRef | null | undefined> {
  const res = await wikiJson<PlaceSearchJson>(placeSearchUrl(lang, search), fetcher);
  if (res === undefined) return undefined;
  const hit = res ? pickPlaceImage(res, q) : null;
  if (!hit) return null;
  const info = await wikiJson<Parameters<typeof parseImageInfo>[0]>(imageInfoUrl(lang, hit.file), fetcher);
  if (info === undefined) return undefined;
  return info ? parseImageInfo(info) : null;
}

const placeKeyOf = (q: PlacePhotoQuery) => [bareName(q.name), fold(q.context ?? ''), q.lat != null ? q.lat.toFixed(2) : '', q.lng != null ? q.lng.toFixed(2) : ''].join('|');

/**
 * Navegador: foto conferida de um lugar. Busca "nome + contexto" e depois só o nome, em português e em inglês,
 * parando na primeira que passa na conferência. No máximo 4 buscas + 1 metadado (antes eram até 12 chamadas).
 */
export async function fetchPlacePhoto(q: PlacePhotoQuery, fetcher: typeof fetch = fetch): Promise<PhotoRef | null> {
  if (bareName(q.name).length < 2) return null;
  const key = `place|${placeKeyOf(q)}`;
  const cached = readCache(key);
  if (cached !== undefined) return cached;
  if (!memory.has(key)) {
    memory.set(key, inQueue(async () => {
      const searches = [...new Set([q.context ? `${q.name} ${q.context}` : '', q.name].map((x) => x.trim()).filter(Boolean))];
      let failed = false;
      for (const lang of ['pt', 'en'] as const) {
        for (const s of searches) {
          const p = await findPlacePhoto(s, q, lang, fetcher);
          if (p) { writeCache(key, p); return p; }
          if (p === undefined) failed = true;
        }
      }
      if (!failed) writeCache(key, null);
      else memory.delete(key);
      return null;
    }));
  }
  return memory.get(key)!;
}

// Uma foto, um lugar: a primeira tela que mostra a foto para um lugar fica com ela; outro lugar não repete.
const claims = new Map<string, string>();
/** true quando a foto pode ser usada por `owner` (livre ou já dele). */
export function claimPhoto(url: string, owner: string): boolean {
  const base = url.replace(/\/\d+px-([^/]+)$/, '/$1');
  const cur = claims.get(base);
  if (cur && cur !== owner) return false;
  claims.set(base, owner);
  return true;
}
/** Só para testes. */
export function resetPhotoClaims() {
  claims.clear();
}
