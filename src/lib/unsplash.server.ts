import 'server-only';
// Unsplash no servidor (ajuste de 14/11/2026): a chave fica aqui, as respostas ficam no cache de dados do Next
// (compartilhado entre todas as trilhas, 30 dias) e um freio evita estourar o limite por hora da chave.
import type { PhotoRef } from '@/data/types';
import { WIKI_USER_AGENT } from './photos';
import {
  isUnsplashId, needFor, pickVerified, toPhotoRef, isUsable, unsplashDownloadUrl, unsplashPhotoUrl, unsplashSearchUrl,
  type UnsplashPhoto, type UnsplashSearch,
} from './unsplash';

const MONTH = 60 * 60 * 24 * 30;
const key = () => process.env.UNSPLASH_ACCESS_KEY?.trim() || '';
export const unsplashConfigured = () => !!key();

// Freio: o Unsplash diz quantas chamadas ainda restam na hora. Abaixo de 4, para até a hora virar.
let pausedUntil = 0;
const canCall = () => Date.now() >= pausedUntil;
function note(r: Response) {
  const left = Number(r.headers.get('x-ratelimit-remaining'));
  if (r.status === 403 || r.status === 429 || (Number.isFinite(left) && r.headers.has('x-ratelimit-remaining') && left < 4)) {
    pausedUntil = Date.now() + 60 * 60 * 1000;
  }
}

/** JSON do Unsplash; `undefined` = não deu (sem chave, limite, rede), `null` = respondeu sem dado útil. */
async function api<T>(url: string): Promise<T | null | undefined> {
  if (!key() || !canCall()) return undefined;
  try {
    // Com cabeçalho Authorization o Next só guarda em cache com force-cache; só respostas 200 são guardadas.
    const r = await fetch(url, {
      headers: { Authorization: `Client-ID ${key()}`, 'Accept-Version': 'v1' },
      cache: 'force-cache',
      next: { revalidate: MONTH },
    });
    note(r);
    if (r.status === 403 || r.status === 429 || r.status >= 500) return undefined;
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return undefined;
  }
}

/** Nome em inglês pela Wikipedia em português (o Unsplash busca e descreve em inglês: "Quioto" → "Kyoto"). */
async function englishName(name: string): Promise<string | null> {
  const url = `https://pt.wikipedia.org/w/api.php?${new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', redirects: '1', prop: 'langlinks', lllang: 'en', titles: name })}`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': WIKI_USER_AGENT, 'Api-User-Agent': WIKI_USER_AGENT }, next: { revalidate: MONTH } });
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return null;
    const j = (await r.json()) as { query?: { pages?: { langlinks?: { title?: string }[] }[] } };
    const t = j.query?.pages?.[0]?.langlinks?.[0]?.title;
    return t ? t.replace(/\s*\(.*\)\s*$/, '').split(',')[0].trim() || null : null;
  } catch {
    return null;
  }
}

export type ResolveAsk =
  | { kind: 'place'; name: string; context?: string | null; lat?: number | null; lng?: number | null; radiusKm?: number }
  | { kind: 'activity'; names: string[]; city: string };

/** Foto conferida do lugar/passeio. `undefined` = o servidor não pôde ajudar (o navegador tenta a Wikipedia). */
export async function resolveUnsplash(ask: ResolveAsk): Promise<PhotoRef | null | undefined> {
  if (!unsplashConfigured()) return undefined;
  if (ask.kind === 'place') {
    const en = await englishName(ask.name);
    const ctxEn = ask.context ? await englishName(ask.context) : null;
    const names = needFor({ kind: 'place', names: [ask.name, ...(en ? [en] : [])] });
    const query = [en ?? ask.name, ctxEn ?? ask.context].filter(Boolean).join(' ');
    const res = await api<UnsplashSearch>(unsplashSearchUrl(query));
    if (res === undefined) return undefined;
    const hit = await pickVerified(res?.results ?? [], { names, lat: ask.lat, lng: ask.lng, radiusKm: ask.radiusKm }, async (id) => api<UnsplashPhoto>(unsplashPhotoUrl(id)));
    return hit ? toPhotoRef(hit) : null;
  }
  const words = needFor(ask);
  if (!words.length) return null;
  const cityEn = (await englishName(ask.city)) ?? ask.city;
  const res = await api<UnsplashSearch>(unsplashSearchUrl(`${words.join(' ')} ${cityEn}`.trim()));
  if (res === undefined) return undefined;
  // Passeio: busca + no máximo 1 detalhe (o limite por hora é curto e as paradas têm prioridade).
  const hit = await pickVerified(res?.results ?? [], { names: words }, async (id) => api<UnsplashPhoto>(unsplashPhotoUrl(id)), 1);
  return hit ? toPhotoRef(hit) : null;
}

/** Opções para a turma escolher à mão ("Trocar foto"): sem conferência, quem olha decide. */
export async function unsplashOptions(name: string, context?: string | null, n = 9): Promise<PhotoRef[] | undefined> {
  if (!unsplashConfigured()) return undefined;
  const en = await englishName(name);
  const ctxEn = context ? await englishName(context) : null;
  const res = await api<UnsplashSearch>(unsplashSearchUrl([en ?? name, ctxEn ?? context].filter(Boolean).join(' '), 20));
  if (res === undefined) return undefined;
  return (res?.results ?? []).filter(isUsable).slice(0, n).map(toPhotoRef);
}

/** Aviso de uso pedido pela diretriz do Unsplash quando a foto é escolhida. Sem cache. */
export async function trackUnsplashDownload(id: string): Promise<boolean> {
  if (!unsplashConfigured() || !isUnsplashId(id) || !canCall()) return false;
  try {
    const r = await fetch(unsplashDownloadUrl(id), { headers: { Authorization: `Client-ID ${key()}`, 'Accept-Version': 'v1' }, cache: 'no-store' });
    note(r);
    return r.ok;
  } catch {
    return false;
  }
}
