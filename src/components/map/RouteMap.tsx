'use client';
import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import type { Stop } from '../../data/types';

/**
 * Mapa interativo (Leaflet + tiles do OpenStreetMap, com atribuição obrigatória).
 * A linha liga as paradas em ordem e NÃO representa o trajeto real por estrada.
 */
export default function RouteMap({ stops, colors, line }: { stops: Stop[]; colors: string[]; line: string }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let map: import('leaflet').Map | null = null;
    let alive = true;
    (async () => {
      const L = await import('leaflet');
      if (!alive || !el.current) return;
      const pts = stops.filter((s) => s.lat != null && s.lng != null);
      map = L.map(el.current, { scrollWheelZoom: false, attributionControl: true });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);
      const latlngs = pts.map((s) => [s.lat as number, s.lng as number] as [number, number]);
      if (latlngs.length > 1) L.polyline(latlngs, { color: line, weight: 4, dashArray: '8 10' }).addTo(map);
      pts.forEach((s) => {
        const i = stops.indexOf(s);
        const icon = L.divIcon({
          className: '',
          html: `<div style="width:30px;height:30px;clip-path:var(--motif-solid);background:${colors[i % colors.length]};display:grid;place-items:center;font:500 13px var(--font-mono);color:#141414">${i + 1}</div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        });
        L.marker([s.lat as number, s.lng as number], { icon, title: s.name, alt: s.name }).addTo(map!).bindPopup(`<b>${s.name.replace(/</g, '&lt;')}</b>`);
      });
      if (latlngs.length) map.fitBounds(L.latLngBounds(latlngs).pad(0.3), { maxZoom: 9 });
      else map.setView([0, 0], 2);
    })();
    return () => {
      alive = false;
      map?.remove();
    };
  }, [stops, colors, line]);
  return <div ref={el} style={{ height: 'min(60vh, 520px)', width: '100%', borderRadius: 22, overflow: 'hidden', border: '1px solid var(--line)' }} role="region" aria-label="Mapa interativo das paradas" />;
}
