import { daysBetween, parseDate, weekday } from './time';

export const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const WEEKDAYS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];

/** "15 jan" */
export function dayMonth(s: string | null | undefined): string {
  if (!s) return '';
  const { mo, d } = parseDate(s);
  return `${d} ${MONTHS[mo - 1]}`;
}

/** "15 JAN 2027" */
export function dayMonthYearU(s: string): string {
  const { y, mo, d } = parseDate(s);
  return `${d} ${MONTHS[mo - 1].toUpperCase()} ${y}`;
}

/** "15 → 17 jan" (ou "30 jan → 2 fev") */
export function dateSpan(a: string, b: string, upper = false): string {
  const A = parseDate(a);
  const B = parseDate(b);
  const out = A.mo === B.mo && A.y === B.y ? `${A.d} → ${B.d} ${MONTHS[B.mo - 1]}` : `${A.d} ${MONTHS[A.mo - 1]} → ${B.d} ${MONTHS[B.mo - 1]}`;
  return upper ? out.toUpperCase() : out;
}

export function nightsLabel(a: string, b: string): string {
  const n = daysBetween(a, b);
  if (n <= 0) return 'bate e volta';
  return `${n} ${n === 1 ? 'noite' : 'noites'}`;
}

/** "15 SEX" */
export function dayWeekU(s: string): string {
  return `${parseDate(s).d} ${WEEKDAYS[weekday(s)]}`;
}

export function hhmm(t: string | null | undefined): string {
  return t ? t.slice(0, 5) : '';
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}

export function formatAltitude(m: number | null | undefined): string {
  if (m == null) return '';
  return `${m.toLocaleString('pt-BR')} m`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Rótulos do SPEC (TransportMode). 'other' = Trem-bala/outros. */
export const MODE_LABEL: Record<string, string> = {
  plane: 'Avião',
  bus: 'Ônibus',
  train: 'Trem',
  car: 'Carro',
  walk: 'A pé',
  boat: 'Barco',
  other: 'Outro',
};

export const MODE_SHORT: Record<string, string> = {
  plane: 'VOO',
  bus: 'ÔNIBUS',
  train: 'TREM',
  car: 'CARRO',
  walk: 'A PÉ',
  boat: 'BARCO',
  other: 'TRECHO',
};

export const CATEGORY_LABEL: Record<string, string> = {
  passagem: 'Passagens',
  identidade: 'Identidade',
  reserva: 'Reservas',
  ingresso: 'Ingressos',
  seguro: 'Seguro',
  outro: 'Outros',
};

export const ROLE_LABEL: Record<string, string> = {
  organizer: 'Organiza',
  editor: 'Pode editar',
  viewer: 'Só consulta',
};
