// Clima das paradas para a Início 3.0 (planning §13). Open-Meteo, grátis e sem chave, direto do navegador.
// Até 15 dias da chegada: previsão. Mais longe que isso: como foi nas MESMAS datas do ano passado (arquivo histórico),
// dito assim na tela. Não inventamos "média do mês".
import type { Stop } from '../data/types';
import { addDays } from './time';

export type WeatherKind = 'forecast' | 'lastYear';
export interface StopWeather { stopId: string; min: number; max: number; kind: WeatherKind; /** previsão: chance máxima de chuva (%); ano passado: dias com chuva ≥ 1 mm */ rain: number | null; days: number }

const FORECAST_DAYS = 15;
const DAILY = 'temperature_2m_max,temperature_2m_min';

/** Mesma data no ano anterior (29/02 vira 28/02). */
export function lastYear(date: string): string {
  const y = Number(date.slice(0, 4)) - 1;
  const md = date.slice(5) === '02-29' ? '02-28' : date.slice(5);
  return `${y}-${md}`;
}

/** URL e tipo da consulta, ou null (sem coordenadas, parada já passou). */
export function weatherRequest(stop: Pick<Stop, 'lat' | 'lng' | 'arrival_date' | 'departure_date'>, today: string): { url: string; kind: WeatherKind } | null {
  if (stop.lat == null || stop.lng == null) return null;
  const last = stop.departure_date > stop.arrival_date ? addDays(stop.departure_date, -1) : stop.arrival_date;
  if (last < today) return null;
  const ll = `latitude=${stop.lat}&longitude=${stop.lng}`;
  const limit = addDays(today, FORECAST_DAYS);
  if (stop.arrival_date <= limit) {
    const start = stop.arrival_date < today ? today : stop.arrival_date;
    const end = last > limit ? limit : last;
    return { kind: 'forecast', url: `https://api.open-meteo.com/v1/forecast?${ll}&daily=${DAILY},precipitation_probability_max&timezone=auto&start_date=${start}&end_date=${end}` };
  }
  return { kind: 'lastYear', url: `https://archive-api.open-meteo.com/v1/archive?${ll}&daily=${DAILY},precipitation_sum&timezone=auto&start_date=${lastYear(stop.arrival_date)}&end_date=${lastYear(last)}` };
}

interface Daily { daily?: { time?: string[]; temperature_2m_max?: (number | null)[]; temperature_2m_min?: (number | null)[]; precipitation_probability_max?: (number | null)[]; precipitation_sum?: (number | null)[] } }

export function parseWeather(json: Daily | null | undefined, stopId: string, kind: WeatherKind): StopWeather | null {
  const d = json?.daily;
  const maxs = (d?.temperature_2m_max ?? []).filter((x): x is number => x != null);
  const mins = (d?.temperature_2m_min ?? []).filter((x): x is number => x != null);
  if (!maxs.length || !mins.length) return null;
  let rain: number | null = null;
  if (kind === 'forecast') {
    const r = (d?.precipitation_probability_max ?? []).filter((x): x is number => x != null);
    rain = r.length ? Math.max(...r) : null;
  } else {
    const r = (d?.precipitation_sum ?? []).filter((x): x is number => x != null);
    rain = r.length ? r.filter((x) => x >= 1).length : null;
  }
  return { stopId, min: Math.round(Math.min(...mins)), max: Math.round(Math.max(...maxs)), kind, rain, days: maxs.length };
}

/** Clima de uma parada, com cache no aparelho até o dia seguinte. null = sem dado (a tela esconde). */
export async function fetchStopWeather(stop: Stop, today: string, fetcher: typeof fetch = fetch): Promise<StopWeather | null> {
  const req = weatherRequest(stop, today);
  if (!req) return null;
  const key = `trilha.wx.v1|${today}|${req.url}`;
  try {
    const hit = localStorage.getItem(key);
    if (hit) return JSON.parse(hit) as StopWeather | null;
  } catch {
    /* sem armazenamento */
  }
  try {
    const r = await fetcher(req.url);
    if (!r.ok) return null;
    const out = parseWeather((await r.json()) as Daily, stop.id, req.kind);
    try {
      localStorage.setItem(key, JSON.stringify(out));
    } catch {
      /* só não guarda */
    }
    return out;
  } catch {
    return null;
  }
}
