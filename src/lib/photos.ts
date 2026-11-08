// Fotos da Wikipedia / Wikimedia Commons (planning §8.1). Funções puras de URL e de parse,
// testáveis sem rede; quem busca é /api/photos (servidor) e quem pede é fetchPhoto (navegador).
// Regra: nunca usar foto de outro lugar. Se a página achada não é do lugar pedido, não há foto.
import type { PhotoRef } from '../data/types';

export const WIKI_LANGS = ['pt', 'en'] as const;
export type WikiLang = (typeof WIKI_LANGS)[number];

/** User-Agent pedido pela política da Wikimedia: identifica o app, sem e-mail pessoal. */
export const WIKI_USER_AGENT = 'Trilha/2.0 (app de planejamento de viagens em grupo; https://github.com/alzolansk/trilha)';

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Imagens que não são foto do lugar: brasões, bandeiras, mapas, logos, desenhos vetoriais. */
export function isUnfitImage(fileName: string): boolean {
  return /\.(svg|gif)$/i.test(fileName)
    || /(flag|bandeira|bandera|coat[ _]of[ _]arms|bras[aã]o|escudo|emblem|logo|seal|selo|map|mapa|locator|location|localiza|montage|collage|icon)/i.test(fileName);
}

/**
 * A página encontrada é do lugar pedido? Compara a primeira parte da busca ("San Blas, Cusco" → "san blas")
 * com o título da página, sem acento. Aceita título que contém a busca ou o contrário.
 */
export function titleMatches(query: string, title: string): boolean {
  const q = fold(query.split(',')[0]);
  const t = fold(title.replace(/\s*\(.*\)\s*$/, ''));
  if (!q || !t) return false;
  return t === q || t.includes(q) || q.includes(t);
}

const api = (lang: WikiLang, params: Record<string, string>) =>
  `https://${lang}.wikipedia.org/w/api.php?${new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', origin: '*', ...params })}`;

/** Busca até 5 páginas com a imagem principal (pageimages). `title` busca a página exata. */
export function searchUrl(lang: WikiLang, q: { q?: string; title?: string }): string {
  if (q.title) return api(lang, { redirects: '1', prop: 'pageimages', piprop: 'name', titles: q.title });
  return api(lang, { generator: 'search', gsrsearch: q.q ?? '', gsrlimit: '5', gsrnamespace: '0', prop: 'pageimages', piprop: 'name' });
}

/** Metadados do arquivo (Commons é repositório compartilhado: a Wikipedia responde por ele). */
export function imageInfoUrl(lang: WikiLang, fileName: string, width = 1200): string {
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
  const pages = [...(json.query?.pages ?? [])].filter((p) => !p.missing).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  for (const p of pages) {
    if (!p.pageimage || isUnfitImage(p.pageimage)) continue;
    if (!titleMatches(query, p.title)) continue;
    return { title: p.title, file: p.pageimage };
  }
  return null;
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
  if (!url || !/^https:\/\/upload\.wikimedia\.org\//.test(url)) return null;
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

/** Navegador: pede a foto ao servidor. null quando não há (ou sem login/rede): o Photo mostra o placeholder. */
export async function fetchPhoto(q: string, lang: WikiLang = 'pt'): Promise<PhotoRef | null> {
  try {
    const r = await fetch(`/api/photos?${new URLSearchParams({ q, lang })}`);
    if (!r.ok) return null;
    const j = (await r.json()) as { photo: PhotoRef | null };
    return j.photo ?? null;
  } catch {
    return null;
  }
}
