'use client';
// Fotos que faltam no roteiro (ajuste de 09/11/2026). Antes, a foto de uma cidade só era buscada quando alguém
// abria a página da parada: quem terminava o "Montar a viagem" via Início e Roteiro inteiros sem foto. Agora,
// quando quem edita abre a trilha (conta real, online), as paradas e passeios sem foto ganham a foto conferida,
// gravada no banco para a turma toda (e para o offline). Um item por vez, cada um tentado uma vez por sessão.
import { useEffect, useRef } from 'react';
import { useAuth } from './AuthContext';
import { useTrip } from './TripContext';
import { claimPhoto, fetchActivityPhoto, fetchPhoto, fetchPlacePhoto } from '../lib/photos';
import type { PhotoRef } from './types';

const MAX_ACTIVITIES = 12;
const tried = new Set<string>();

export function usePhotoBackfill() {
  const { bundle, source, reload, canEdit } = useTrip();
  const { online } = useAuth();
  const running = useRef(false);
  const stopsKey = bundle ? bundle.stops.filter((s) => !s.photo?.url).map((s) => s.id).join(',') : '';
  const actsKey = bundle ? bundle.activities.filter((a) => !a.photo?.url).map((a) => a.id).join(',') : '';
  useEffect(() => {
    if (!bundle || !canEdit || !online || source.kind !== 'supabase' || running.current) return;
    const stops = bundle.stops.filter((s) => !s.photo?.url && !tried.has(s.id)).sort((a, b) => a.position - b.position);
    const acts = bundle.activities.filter((a) => !a.photo?.url && !tried.has(a.id)).slice(0, MAX_ACTIVITIES);
    if (!stops.length && !acts.length) return;
    running.current = true;
    let alive = true;
    void (async () => {
      let saved = 0;
      const save = async (table: 'stops' | 'activities', id: string, version: number, photo: PhotoRef | null, owner: string) => {
        if (!photo?.url || !claimPhoto(photo.url, owner)) return;
        try {
          await source.update(table, id, { photo }, version);
          saved++;
        } catch {
          /* alguém mexeu ao mesmo tempo: tenta de novo na próxima abertura */
        }
      };
      // Cidades primeiro (capa do Início e do Roteiro): conferida por nome + coordenadas; sem coordenadas, pela busca simples.
      for (const s of stops) {
        if (!alive) break;
        tried.add(s.id);
        const photo = s.lat != null && s.lng != null
          ? await fetchPlacePhoto({ name: s.name, context: s.country, lat: s.lat, lng: s.lng, radiusKm: 40 })
          : await fetchPhoto([s.name, s.country].filter(Boolean).join(', '));
        await save('stops', s.id, s.version, photo, `${s.name}|${s.country ?? ''}`.toLowerCase());
      }
      for (const a of acts) {
        if (!alive) break;
        tried.add(a.id);
        const city = bundle.stops.find((s) => s.id === a.stop_id)?.name ?? '';
        const photo = await fetchActivityPhoto([a.title.replace(/^Bate-volta: /, '')], city);
        await save('activities', a.id, a.version, photo, `act|${a.title}|${city}`.toLowerCase());
      }
      running.current = false;
      if (saved && alive) await reload();
    })();
    return () => {
      alive = false;
      running.current = false;
    };
  }, [bundle?.trip.id, stopsKey, actsKey, canEdit, online, source.kind]); // eslint-disable-line react-hooks/exhaustive-deps
}
