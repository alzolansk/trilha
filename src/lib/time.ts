// Datas e fusos sem dependências: datas de calendário são strings 'YYYY-MM-DD'
// e instantes são milissegundos UTC. Conversões de fuso usam Intl (IANA).

export interface Wall {
  y: number;
  mo: number; // 1-12
  d: number;
  h: number;
  mi: number;
  s: number;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    partsFormatter(tz);
    return true;
  } catch {
    return false;
  }
}

export function instantToWall(tz: string, ms: number): Wall {
  const parts = partsFormatter(tz).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour') % 24, mi: get('minute'), s: get('second') };
}

/** Diferença (ms) entre o relógio local do fuso e UTC naquele instante. */
export function tzOffsetMs(tz: string, ms: number): number {
  const w = instantToWall(tz, ms);
  const asUtc = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Converte horário de parede num fuso para instante UTC (horários inexistentes avançam). */
export function wallToInstant(tz: string, w: Wall): number {
  const naive = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
  let guess = naive - tzOffsetMs(tz, naive);
  const off2 = tzOffsetMs(tz, guess);
  guess = naive - off2;
  return guess;
}

export function daysInMonth(y: number, mo: number): number {
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/** Soma meses mantendo o dia, limitado ao último dia do mês (31 jan + 1 = 28/29 fev). */
export function addMonthsClamped(w: Wall, n: number): Wall {
  const total = w.y * 12 + (w.mo - 1) + n;
  const y = Math.floor(total / 12);
  const mo = (total % 12) + 1;
  return { ...w, y, mo, d: Math.min(w.d, daysInMonth(y, mo)) };
}

export interface Countdown {
  months: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  /** dias corridos restantes, arredondados para cima (para frases como "Faltam N dias") */
  totalDays: number;
  done: boolean;
}

/**
 * Contagem regressiva em meses de calendário + dias/horas/min/seg.
 * Os meses são contados no relógio do fuso da partida, para que viradas de mês
 * e horário de verão sigam o calendário de quem vai viajar.
 */
export function countdown(nowMs: number, targetMs: number, tz: string): Countdown {
  if (nowMs >= targetMs) {
    return { months: 0, days: 0, hours: 0, minutes: 0, seconds: 0, totalDays: 0, done: true };
  }
  const start = instantToWall(tz, nowMs);
  let months = 0;
  let base = nowMs;
  for (let i = 1; i < 1200; i++) {
    const c = wallToInstant(tz, addMonthsClamped(start, i));
    if (c <= targetMs) {
      months = i;
      base = c;
    } else break;
  }
  let diff = Math.floor((targetMs - base) / 1000);
  const days = Math.floor(diff / 86400);
  diff -= days * 86400;
  const hours = Math.floor(diff / 3600);
  diff -= hours * 3600;
  const minutes = Math.floor(diff / 60);
  const seconds = diff - minutes * 60;
  return { months, days, hours, minutes, seconds, totalDays: Math.ceil((targetMs - nowMs) / 864e5), done: false };
}

// ───────── Datas de calendário ─────────

export function parseDate(s: string): { y: number; mo: number; d: number } {
  const [y, mo, d] = s.split('-').map(Number);
  return { y, mo, d };
}

export function dateToUtcMs(s: string): number {
  const { y, mo, d } = parseDate(s);
  return Date.UTC(y, mo - 1, d);
}

export function utcMsToDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(s: string, n: number): string {
  return utcMsToDate(dateToUtcMs(s) + n * 864e5);
}

/** Número de noites/dias entre duas datas (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((dateToUtcMs(b) - dateToUtcMs(a)) / 864e5);
}

export function weekday(s: string): number {
  return new Date(dateToUtcMs(s)).getUTCDay();
}

export function todayIn(tz: string, nowMs = Date.now()): string {
  const w = instantToWall(tz, nowMs);
  return `${w.y}-${String(w.mo).padStart(2, '0')}-${String(w.d).padStart(2, '0')}`;
}

export function dateRange(a: string, b: string): string[] {
  const out: string[] = [];
  const n = daysBetween(a, b);
  for (let i = 0; i <= n && i < 400; i++) out.push(addDays(a, i));
  return out;
}

/** "1 ano e 2 meses", "3 meses", "12 dias" — para listas de outras viagens. */
export function humanUntil(nowMs: number, targetMs: number, tz: string): string {
  const c = countdown(nowMs, targetMs, tz);
  if (c.done) return 'Já começou';
  const y = Math.floor(c.months / 12);
  const m = c.months % 12;
  if (y > 0) {
    const ys = `${y} ${y === 1 ? 'ano' : 'anos'}`;
    return m ? `${ys} e ${m} ${m === 1 ? 'mês' : 'meses'}` : ys;
  }
  if (c.totalDays > 300 && m) return `${m} ${m === 1 ? 'mês' : 'meses'}`;
  return `${c.totalDays} ${c.totalDays === 1 ? 'dia' : 'dias'}`;
}

/** Diferença de horário entre dois fusos num instante, em horas (b - a). */
export function tzDiffHours(a: string, b: string, ms = Date.now()): number {
  return (tzOffsetMs(b, ms) - tzOffsetMs(a, ms)) / 36e5;
}

export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo';
  } catch {
    return 'America/Sao_Paulo';
  }
}

export function listTimeZones(): string[] {
  const anyIntl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  try {
    const list = anyIntl.supportedValuesOf?.('timeZone');
    if (list && list.length) return list;
  } catch {
    /* navegadores antigos */
  }
  return [
    'America/Sao_Paulo', 'America/Manaus', 'America/Fortaleza', 'America/Lima', 'America/La_Paz',
    'America/Santiago', 'America/Argentina/Buenos_Aires', 'America/Bogota', 'America/Mexico_City',
    'America/New_York', 'America/Los_Angeles', 'Europe/Lisbon', 'Europe/Madrid', 'Europe/Paris',
    'Europe/London', 'Asia/Tokyo', 'UTC',
  ];
}
