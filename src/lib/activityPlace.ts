// Passeios no mapa (ajuste de 09/11): onde cada atividade acontece e, quando é um percurso
// (trem panorâmico, barco, estrada cênica), o trajeto aproximado. Puro e testável.
//
// De onde vem o lugar, em ordem:
// 1. `activities.place` gravado (IA, busca do OpenStreetMap na janela da atividade);
// 2. sem ele, o ponto do bate-volta na rota do onboarding ("Bate-volta: Bernina Express" → a proposta
//    já tinha as coordenadas), para o mapa não perder o que a proposta mostrava.
import type { Activity, ActivityPlace, PathPoint, Stop, TripBundle } from '../data/types';
import { haversineKm } from './derive';
import { placeKey } from './onboarding';

/** Distância máxima (km) entre o passeio e a parada: mais longe que isso é erro da IA. */
export const MAX_KM = 400;
/** A partir daqui (km) o passeio é "fora da cidade": aparece sempre no mapa, ligado à parada. */
export const FAR_KM = 15;
/** Pontos de um trajeto. */
export const PATH_MIN = 2;
export const PATH_MAX = 12;

type LatLng = [number, number];
export type PlacedActivityPlace = ActivityPlace & { lat: number; lng: number };

const okCoord = (lat: unknown, lng: unknown): boolean =>
  typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)
  && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

export function hasCoords(p: ActivityPlace | null | undefined): p is PlacedActivityPlace {
  return !!p && !p.none && okCoord(p.lat, p.lng);
}

const stopPoint = (s: Pick<Stop, 'lat' | 'lng'> | null | undefined): LatLng | null =>
  s && okCoord(s.lat, s.lng) ? [s.lat as number, s.lng as number] : null;

export interface RawPlace {
  name?: string | null;
  lat?: number | null;
  lng?: number | null;
  path?: { name?: string | null; lat?: number | null; lng?: number | null }[] | null;
}

/**
 * Confere um lugar vindo da IA: coordenadas válidas e a no máximo `MAX_KM` da parada. O trajeto
 * só fica se tiver de 2 a 12 pontos válidos e todos perto da parada; senão o ponto fica sem trajeto.
 * Sem ponto principal, usa o meio do trajeto. Devolve null quando não dá para confiar.
 */
export function cleanPlace(raw: RawPlace | null | undefined, stop: Pick<Stop, 'lat' | 'lng' | 'name'> | null, by: ActivityPlace['by'] = 'ai'): PlacedActivityPlace | null {
  if (!raw) return null;
  const home = stopPoint(stop);
  const near = (lat: number, lng: number) => !home || haversineKm(home, [lat, lng]) <= MAX_KM;
  let path: PathPoint[] | null = null;
  if (Array.isArray(raw.path)) {
    const pts = raw.path.filter((x) => x && okCoord(x.lat, x.lng)).map((x) => ({ name: String(x.name ?? '').trim().slice(0, 80), lat: x.lat as number, lng: x.lng as number }));
    if (pts.length >= PATH_MIN && pts.length === raw.path.length && pts.every((x) => near(x.lat, x.lng))) path = pts.slice(0, PATH_MAX);
  }
  let lat = raw.lat;
  let lng = raw.lng;
  if (!okCoord(lat, lng) && path) {
    const mid = path[Math.floor(path.length / 2)];
    lat = mid.lat;
    lng = mid.lng;
  }
  if (!okCoord(lat, lng) || !near(lat as number, lng as number)) return null;
  const name = String(raw.name ?? '').trim().slice(0, 80) || path?.[0]?.name || stop?.name || 'Passeio';
  return { name, lat: lat as number, lng: lng as number, path, by };
}

/** "Bate-volta: Bernina Express" → "Bernina Express". */
export function dayTripName(title: string): string | null {
  const m = title.match(/^\s*bate[\s-]?volta\s*[:·–-]\s*(.+?)\s*$/i);
  return m ? m[1] : null;
}

/** Ponto do bate-volta como a proposta do onboarding mostrava (coordenadas da rota ou do resumo do lugar). */
export function routePlaceFor(b: Pick<TripBundle, 'trip'>, stop: Pick<Stop, 'name'> | null | undefined, title: string): PlacedActivityPlace | null {
  const name = dayTripName(title);
  const ob = b.trip.onboarding;
  if (!name || !ob?.route) return null;
  const k = placeKey(name);
  const own = stop ? ob.route.stops.find((s) => placeKey(s.name) === placeKey(stop.name)) : null;
  const d = own?.day_trips.find((x) => placeKey(x.name) === k)
    ?? ob.route.stops.flatMap((s) => s.day_trips).find((x) => placeKey(x.name) === k);
  if (!d) return null;
  const info = ob.info?.[k];
  const near = ob.places?.nearby.find((x) => placeKey(x.name) === k);
  const item = ob.places?.items.find((x) => placeKey(x.name) === k);
  const c = [[d.lat, d.lng], [info?.lat, info?.lng], [near?.lat, near?.lng], [item?.lat, item?.lng]].find(([la, ln]) => okCoord(la, ln));
  return c ? { name: d.name, lat: c[0] as number, lng: c[1] as number, by: 'route' } : null;
}

/** Onde a atividade acontece (gravado ou, sem isso, o ponto da rota). null = fora do mapa. */
export function placeOf(b: Pick<TripBundle, 'trip' | 'stops'>, a: Pick<Activity, 'place' | 'title' | 'stop_id'>): PlacedActivityPlace | null {
  if (a.place?.none) return null;
  if (hasCoords(a.place)) return a.place;
  return routePlaceFor(b, b.stops.find((s) => s.id === a.stop_id), a.title);
}

/**
 * Vale perguntar à IA? Sem lugar gravado, ou só com o ponto da rota (o trajeto ainda não foi procurado).
 * Lugar escolhido na busca do OpenStreetMap e "não é lugar" não são perguntados de novo.
 */
export function needsLocate(a: Pick<Activity, 'place'>): boolean {
  const p = a.place;
  if (!p) return true;
  if (p.none || p.by === 'osm') return false;
  return p.path === undefined;
}

/** "Tirano → Alp Grüm → St. Moritz" (sem nomes repetidos em sequência). */
export function pathLabel(path: PathPoint[] | null | undefined): string {
  if (!path?.length) return '';
  return path.map((x) => x.name).filter((n, i, all) => n && n !== all[i - 1]).join(' → ');
}

export interface ActivityMark {
  id: string;
  stopId: string;
  title: string;
  day: string;
  /** nome do lugar (quando difere do título) */
  place: string | null;
  lat: number;
  lng: number;
  path: LatLng[] | null;
  /** nome de cada ponto do trajeto, na mesma ordem de `path` */
  pathNames: string[];
  pathLabel: string;
  /** fora da cidade (bate-volta ou percurso): sempre no mapa e ligado à parada */
  far: boolean;
  /** de onde veio o ponto (o mapa avisa quando é aproximado) */
  by: ActivityPlace['by'];
}

/** Atividades com lugar, na ordem do roteiro, prontas para o mapa. */
export function activityMarks(b: Pick<TripBundle, 'trip' | 'stops' | 'activities'>): ActivityMark[] {
  const out: ActivityMark[] = [];
  const sorted = [...b.activities].sort((x, y) => x.day.localeCompare(y.day) || x.position - y.position);
  for (const a of sorted) {
    const p = placeOf(b, a);
    if (!p) continue;
    const home = stopPoint(b.stops.find((s) => s.id === a.stop_id));
    const path = p.path?.length ? p.path.map((x) => [x.lat, x.lng] as LatLng) : null;
    const dist = (pt: LatLng) => (home ? haversineKm(home, pt) : Infinity);
    const far = dist([p.lat, p.lng]) > FAR_KM || !!path?.some((pt) => dist(pt) > FAR_KM);
    const placeName = p.name && placeKey(p.name) !== placeKey(dayTripName(a.title) ?? a.title) ? p.name : null;
    out.push({ id: a.id, stopId: a.stop_id, title: a.title, day: a.day, place: placeName, lat: p.lat, lng: p.lng, path, pathNames: p.path?.map((x) => x.name) ?? [], pathLabel: pathLabel(p.path), far, by: p.by });
  }
  return out;
}
