'use client';
import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import type { ActivityMark } from '../../lib/activityPlace';
import { dayWeekU } from '../../lib/format';
import { fgOn } from '../../lib/identity/contrast';
import { ICONS } from '../ui/icons.data';

/** Ponto numerado da rota: uma parada gravada (`Stop`) ou uma parada da proposta do onboarding. */
export interface MapStop {
  id: string;
  name: string;
  lat?: number | null;
  lng?: number | null;
}
/**
 * Ponto fora da sequência: bate-volta (ligado à parada de onde sai) ou lugar que ficou de fora
 * (pino tracejado; em destaque quando é o `focusId`).
 */
export interface MapExtra {
  id: string;
  name: string;
  lat: number;
  lng: number;
  kind: 'trip' | 'out' | 'base';
  /** id da parada ligada (bate-volta ou cidade onde se dorme): desenha uma linha fina até ela */
  from?: string | null;
  /** texto curto mostrado junto do nome (ex.: o motivo de ter ficado de fora) */
  note?: string | null;
}

const NO_EXTRAS: MapExtra[] = [];
const NO_ACTS: ActivityMark[] = [];
/** Zoom a partir do qual os passeios dentro da cidade aparecem (de longe eles cobririam o pino da parada). */
export const NEAR_ZOOM = 11;
const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Mapa interativo (Leaflet + tiles do OpenStreetMap, com atribuição obrigatória). Pino numerado na cor
 * da trilha (`accent`) e linha brand. A linha liga as paradas em ordem e NÃO é o trajeto real por estrada.
 * Tocar num pino chama `onOpen` (abre a parada); num ponto extra, `onOpenExtra`.
 */
export default function RouteMap({ stops, extras = NO_EXTRAS, activities = NO_ACTS, accent, height = 'min(60vh, 520px)', onOpen, onOpenExtra, onOpenActivity, focusId, label = 'Mapa interativo das paradas' }: {
  stops: MapStop[];
  extras?: MapExtra[];
  /** passeios do roteiro com lugar (lib/activityPlace.activityMarks): pino, trajeto e ligação com a parada */
  activities?: ActivityMark[];
  onOpenActivity?: (id: string) => void;
  accent: string;
  height?: string;
  onOpen?: (stopId: string) => void;
  onOpenExtra?: (id: string) => void;
  /** parada ou ponto extra destacado (pino maior; num extra, o mapa se aproxima dele) */
  focusId?: string | null;
  label?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  const extraRef = useRef(onOpenExtra);
  extraRef.current = onOpenExtra;
  const actRef = useRef(onOpenActivity);
  actRef.current = onOpenActivity;
  useEffect(() => {
    let map: import('leaflet').Map | null = null;
    let alive = true;
    (async () => {
      const L = await import('leaflet');
      if (!alive || !el.current) return;
      const css = getComputedStyle(document.documentElement);
      const brand = css.getPropertyValue('--brand').trim() || '#2B3FF5';
      const sun = css.getPropertyValue('--sun').trim() || '#F5A524';
      const fg = fgOn(accent);
      const pts = stops.filter((s) => s.lat != null && s.lng != null);
      // Zoom pela rodinha do mouse (pedido de 09/11); suave, meio nível por passo.
      map = L.map(el.current, { scrollWheelZoom: true, wheelPxPerZoomLevel: 120, zoomSnap: 0.5, attributionControl: true, zoomControl: true });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);
      const latlngs = pts.map((s) => [s.lat as number, s.lng as number] as [number, number]);
      if (latlngs.length > 1) L.polyline(latlngs, { color: brand, weight: 4, opacity: 0.9, dashArray: '2 9', lineCap: 'round' }).addTo(map);

      // Bate-voltas: linha fina da parada até o lugar.
      for (const x of extras) {
        if (x.kind === 'out' || !x.from) continue;
        const base = pts.find((s) => s.id === x.from);
        if (base) L.polyline([[base.lat as number, base.lng as number], [x.lat, x.lng]], { color: accent, weight: 2, opacity: 0.7, dashArray: '1 6' }).addTo(map);
      }
      const focusExtra = extras.find((x) => x.id === focusId) ?? null;
      for (const x of extras) {
        const big = x.id === focusId;
        const out = x.kind === 'out';
        const home = x.kind === 'base';
        const size = big ? 34 : out ? 22 : home ? 20 : 16;
        const style = out
          ? `background:${big ? sun : '#fff'};border:2.5px dashed ${big ? '#fff' : sun};color:${big ? '#111' : sun};font:800 ${big ? 16 : 12}px/1 var(--font-body)`
          : home ? `background:${accent};border:2px solid #fff;border-radius:6px;color:${fg};font:800 11px/1 var(--font-body)`
          : `background:#fff;border:3px solid ${accent}`;
        const icon = L.divIcon({
          className: '',
          html: `<div style="width:${size}px;height:${size}px;border-radius:999px;display:grid;place-items:center;box-sizing:border-box;${style};box-shadow:0 2px 8px rgba(13,16,23,.25)${big ? ',0 0 0 6px color-mix(in srgb, ' + sun + ' 35%, transparent)' : ''}">${out ? '+' : ''}</div>`,
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        });
        const what = out ? 'Ficou de fora' : home ? 'Onde vocês dormem' : 'Bate-volta';
        const m = L.marker([x.lat, x.lng], { icon, title: x.name, alt: `${what}: ${x.name}`, keyboard: true, zIndexOffset: big ? 1000 : out ? 200 : 0 }).addTo(map!);
        m.bindTooltip(`<b>${esc(x.name)}</b>${x.note ? `<br><small>${esc(x.note)}</small>` : `<br><small>${what}</small>`}`, { direction: 'top', offset: [0, -size / 2], permanent: big });
        m.on('click', () => extraRef.current?.(x.id));
        m.on('keypress', (e: { originalEvent?: KeyboardEvent }) => {
          if (e.originalEvent?.key === 'Enter') extraRef.current?.(x.id);
        });
      }

      // Passeios: trajeto em linha cheia (cor da trilha com contorno branco), ligação pontilhada da parada
      // até o passeio fora da cidade e um pino pequeno. Os de dentro da cidade só aparecem de perto.
      const nearLayer = L.layerGroup();
      const glyph = ICONS.ticket;
      for (const a of activities) {
        const layer: import('leaflet').Map | import('leaflet').LayerGroup = a.far ? map : nearLayer;
        const open = () => actRef.current?.(a.id);
        const where = a.pathLabel || a.place;
        const tip = `<b>${esc(a.title)}</b><br><small>${esc(dayWeekU(a.day))}${where ? ` · ${esc(where)}` : ''}</small>`;
        const home = pts.find((s) => s.id === a.stopId);
        const start: [number, number] = a.path?.[0] ?? [a.lat, a.lng];
        if (home && a.far) L.polyline([[home.lat as number, home.lng as number], start], { color: accent, weight: 2, opacity: 0.7, dashArray: '1 6', interactive: false }).addTo(layer);
        if (a.path) {
          L.polyline(a.path, { color: '#fff', weight: 8, opacity: 0.95, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(layer);
          const line = L.polyline(a.path, { color: accent, weight: 4, opacity: 1, lineCap: 'round', lineJoin: 'round' }).addTo(layer);
          line.bindTooltip(`<b>${esc(a.title)}</b><br><small>${esc(a.pathLabel)}</small>`, { sticky: true });
          line.on('click', open);
          a.path.forEach((pt, i) => {
            const c = L.circleMarker(pt, { radius: i === 0 || i === a.path!.length - 1 ? 4 : 3, color: accent, weight: 2, fillColor: '#fff', fillOpacity: 1 }).addTo(layer);
            const name = a.pathNames[i];
            if (name) c.bindTooltip(esc(name), { direction: 'top' });
          });
        }
        const icon = L.divIcon({
          className: '',
          html: `<div style="width:26px;height:26px;border-radius:9px;background:#fff;border:2.5px solid ${accent};color:${accent};display:grid;place-items:center;box-sizing:border-box;box-shadow:0 2px 8px rgba(13,16,23,.25)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${glyph}</svg></div>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        });
        const m = L.marker([a.lat, a.lng], { icon, title: a.title, alt: `Passeio: ${a.title}`, keyboard: true, zIndexOffset: 300 }).addTo(layer);
        m.bindTooltip(tip, { direction: 'top', offset: [0, -13] });
        m.on('click', open);
        m.on('keypress', (e: { originalEvent?: KeyboardEvent }) => {
          if (e.originalEvent?.key === 'Enter') open();
        });
      }
      const syncNear = () => {
        if (!map) return;
        if (map.getZoom() >= NEAR_ZOOM) nearLayer.addTo(map);
        else nearLayer.remove();
      };
      map.on('zoomend', syncNear);

      pts.forEach((s) => {
        const i = stops.indexOf(s);
        const big = s.id === focusId;
        const size = big ? 38 : 30;
        const icon = L.divIcon({
          className: '',
          html: `<div style="width:${size}px;height:${size}px;border-radius:999px;background:${accent};color:${fg};display:grid;place-items:center;font:800 ${big ? 15 : 13}px/1 var(--font-body);box-shadow:0 0 0 3px #fff,0 4px 12px rgba(13,16,23,.25)">${i + 1}</div>`,
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        });
        const m = L.marker([s.lat as number, s.lng as number], { icon, title: s.name, alt: `Parada ${i + 1}: ${s.name}`, keyboard: true, zIndexOffset: 500 }).addTo(map!);
        m.bindTooltip(esc(s.name), { direction: 'top', offset: [0, -size / 2] });
        m.on('click', () => openRef.current?.(s.id));
        m.on('keypress', (e: { originalEvent?: KeyboardEvent }) => {
          if (e.originalEvent?.key === 'Enter') openRef.current?.(s.id);
        });
      });
      // Enquadra a rota e os bate-voltas; um lugar de fora em destaque entra no quadro (mostra o quanto foge da rota).
      // Passeios fora da cidade (e o trajeto inteiro deles) também entram no quadro.
      const frame = [
        ...latlngs,
        ...extras.filter((x) => x.kind !== 'out').map((x) => [x.lat, x.lng] as [number, number]),
        ...activities.filter((a) => a.far).flatMap((a) => [[a.lat, a.lng] as [number, number], ...(a.path ?? [])]),
      ];
      if (focusExtra) frame.push([focusExtra.lat, focusExtra.lng]);
      if (frame.length) map.fitBounds(L.latLngBounds(frame).pad(0.2), { maxZoom: 9 });
      else map.setView([0, 0], 2);
      syncNear();
    })();
    return () => {
      alive = false;
      map?.remove();
    };
  }, [stops, extras, activities, accent, focusId]);
  return <div ref={el} style={{ height, width: '100%', borderRadius: 'var(--r-card)', overflow: 'hidden', background: 'var(--field)' }} role="region" aria-label={label} />;
}
