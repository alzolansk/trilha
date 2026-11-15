'use client';
// Fotos que faltam no roteiro (ajuste de 09/11/2026). Antes, a foto de uma cidade só era buscada quando alguém
// abria a página da parada: quem terminava o "Montar a viagem" via Início e Roteiro inteiros sem foto. Agora,
// quando quem edita abre a trilha (conta real, online), as paradas e passeios sem foto ganham a foto conferida,
// gravada no banco para a turma toda (e para o offline). Um item por vez, cada um tentado uma vez por sessão.
import { useEffect, useRef } from 'react';
import { useAuth } from './AuthContext';
import { useTrip } from './TripContext';
import { claimPhoto, fetchActivityPhoto, fetchPhoto, fetchPlacePhoto, fetchServerPhoto, hasPhotoServer } from '../lib/photos';
import { trackPhotoUse } from './photoServer';
import type { PhotoRef, Stop } from './types';

/** Foto automática antiga da Wikimedia, que ninguém escolheu à mão: pode ser trocada por uma do Unsplash. */
export const canUpgrade = (p: PhotoRef | null | undefined) => !!p?.url && !p.path && !p.picked && p.provider !== 'unsplash';

const MAX_ACTIVITIES = 12;
const MAX_UPGRADES = 8;
const tried = new Set<string>();

export function usePhotoBackfill() {
  const { bundle, source, reload, canEdit } = useTrip();
  const { online } = useAuth();
  const running = useRef(false);
  const stopsKey = bundle ? bundle.stops.filter((s) => !s.photo?.url).map((s) => s.id).join(',') : '';
  const actsKey = bundle ? bundle.activities.filter((a) => !a.photo?.url).map((a) => a.id).join(',') : '';
  const upKey = bundle ? bundle.stops.filter((s) => canUpgrade(s.photo)).map((s) => s.id).join(',') : '';
  useEffect(() => {
    if (!bundle || !canEdit || !online || source.kind !== 'supabase' || running.current) return;
    const stops = bundle.stops.filter((s) => !s.photo?.url && !tried.has(s.id)).sort((a, b) => a.position - b.position);
    const acts = bundle.activities.filter((a) => !a.photo?.url && !tried.has(a.id)).slice(0, MAX_ACTIVITIES);
    // Troca (14/11/2026): paradas com foto antiga da Wikimedia ganham a do Unsplash, se o servidor tiver uma conferida.
    const upgrades: Stop[] = hasPhotoServer() ? bundle.stops.filter((s) => canUpgrade(s.photo) && !tried.has(`up:${s.id}`)).slice(0, MAX_UPGRADES) : [];
    if (!stops.length && !acts.length && !upgrades.length) return;
    running.current = true;
    let alive = true;
    void (async () => {
      let saved = 0;
      const save = async (table: 'stops' | 'activities', id: string, version: number, photo: PhotoRef | null, owner: string) => {
        if (!photo?.url || !claimPhoto(photo.url, owner)) return;
        try {
          await source.update(table, id, { photo }, version);
          trackPhotoUse(photo);
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
      for (const s of upgrades) {
        if (!alive) break;
        tried.add(`up:${s.id}`);
        const photo = await fetchServerPhoto({ kind: 'place', name: s.name, context: s.country, lat: s.lat, lng: s.lng, radiusKm: 40 });
        if (photo?.provider === 'unsplash') await save('stops', s.id, s.version, photo, `${s.name}|${s.country ?? ''}`.toLowerCase());
      }
      running.current = false;
      if (saved && alive) await reload();
    })();
    return () => {
      alive = false;
      running.current = false;
    };
  }, [bundle?.trip.id, stopsKey, actsKey, upKey, canEdit, online, source.kind]); // eslint-disable-line react-hooks/exhaustive-deps
}
