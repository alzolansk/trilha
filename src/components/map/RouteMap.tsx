'use client';
import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import type { Stop } from '../../data/types';
import { fgOn } from '../../lib/identity/contrast';

/**
 * Mapa interativo (Leaflet + tiles do OpenStreetMap, com atribuição obrigatória). Pino numerado na cor
 * da trilha (`accent`) e linha brand. A linha liga as paradas em ordem e NÃO é o trajeto real por estrada.
 * Tocar num pino chama `onOpen` (abre a parada).
 */
export default function RouteMap({ stops, accent, height = 'min(60vh, 520px)', onOpen, focusId }: {
  stops: Stop[];
  accent: string;
  height?: string;
  onOpen?: (stopId: string) => void;
  /** parada destacada (pino maior) */
  focusId?: string | null;
}) {
  const el = useRef<HTMLDivElement>(null);
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  useEffect(() => {
    let map: import('leaflet').Map | null = null;
    let alive = true;
    (async () => {
      const L = await import('leaflet');
      if (!alive || !el.current) return;
      const css = getComputedStyle(document.documentElement);
      const brand = css.getPropertyValue('--brand').trim() || '#2B3FF5';
      const fg = fgOn(accent);
      const pts = stops.filter((s) => s.lat != null && s.lng != null);
      map = L.map(el.current, { scrollWheelZoom: false, attributionControl: true, zoomControl: true });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);
      const latlngs = pts.map((s) => [s.lat as number, s.lng as number] as [number, number]);
      if (latlngs.length > 1) L.polyline(latlngs, { color: brand, weight: 4, opacity: 0.9, dashArray: '2 9', lineCap: 'round' }).addTo(map);
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
        const m = L.marker([s.lat as number, s.lng as number], { icon, title: s.name, alt: `Parada ${i + 1}: ${s.name}`, keyboard: true }).addTo(map!);
        m.bindTooltip(s.name.replace(/</g, '&lt;'), { direction: 'top', offset: [0, -size / 2] });
        m.on('click', () => openRef.current?.(s.id));
        m.on('keypress', (e: { originalEvent?: KeyboardEvent }) => {
          if (e.originalEvent?.key === 'Enter') openRef.current?.(s.id);
        });
      });
      if (latlngs.length) map.fitBounds(L.latLngBounds(latlngs).pad(0.25), { maxZoom: 9 });
      else map.setView([0, 0], 2);
    })();
    return () => {
      alive = false;
      map?.remove();
    };
  }, [stops, accent, focusId]);
  return <div ref={el} style={{ height, width: '100%', borderRadius: 'var(--r-card)', overflow: 'hidden', background: 'var(--field)' }} role="region" aria-label="Mapa interativo das paradas" />;
}
