'use client';
import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import { fgOn } from '../../lib/identity/contrast';

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
const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Mapa interativo (Leaflet + tiles do OpenStreetMap, com atribuição obrigatória). Pino numerado na cor
 * da trilha (`accent`) e linha brand. A linha liga as paradas em ordem e NÃO é o trajeto real por estrada.
 * Tocar num pino chama `onOpen` (abre a parada); num ponto extra, `onOpenExtra`.
 */
export default function RouteMap({ stops, extras = NO_EXTRAS, accent, height = 'min(60vh, 520px)', onOpen, onOpenExtra, focusId, label = 'Mapa interativo das paradas' }: {
  stops: MapStop[];
  extras?: MapExtra[];
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
      map = L.map(el.current, { scrollWheelZoom: false, attributionControl: true, zoomControl: true });
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
      const frame = [...latlngs, ...extras.filter((x) => x.kind !== 'out').map((x) => [x.lat, x.lng] as [number, number])];
      if (focusExtra) frame.push([focusExtra.lat, focusExtra.lng]);
      if (frame.length) map.fitBounds(L.latLngBounds(frame).pad(0.2), { maxZoom: 9 });
      else map.setView([0, 0], 2);
    })();
    return () => {
      alive = false;
      map?.remove();
    };
  }, [stops, extras, accent, focusId]);
  return <div ref={el} style={{ height, width: '100%', borderRadius: 'var(--r-card)', overflow: 'hidden', background: 'var(--field)' }} role="region" aria-label={label} />;
}
