// Leitura de passagem (canvas "cidade e reservas", fase 3): texto do PDF, da foto (OCR) ou do e-mail
// colado → os campos do bilhete. Puro e testável. Só devolve o que achou com segurança; o resto fica
// para a pessoa. Nada é gravado sem ela ver o resultado.
import { KNOWN_AIRPORTS } from './airports';

export interface ParsedTicket {
  flight?: string;
  origin_code?: string;
  dest_code?: string;
  depart_date?: string;
  depart_time?: string;
  arrive_date?: string;
  arrive_time?: string;
  booking_ref?: string;
  seat?: string;
}

const MONTHS: Record<string, number> = {
  jan: 1, fev: 2, feb: 2, mar: 3, abr: 4, apr: 4, mai: 5, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, set: 9, sep: 9, out: 10, oct: 10, nov: 11, dez: 12, dec: 12,
};
const AIRLINES = new Set(['LA', 'G3', 'AD', 'AZ', 'TP', 'AF', 'KL', 'LH', 'IB', 'UX', 'AA', 'UA', 'DL', 'EK', 'QR', 'AV', 'CM', 'H2', 'JJ', 'BA', 'LX', 'TK', 'AR', 'JA', 'VY', 'FR', 'U2', 'XL', 'LP', 'AM', 'B6']);
const pad = (n: number) => String(n).padStart(2, '0');
const WORD_REF = /(?:localizador|c[óo]digo\s+(?:de\s+)?reserva|c[óo]digo\s+da\s+reserva|booking\s+(?:ref(?:erence)?|code)|record\s+locator|confirma[çc][ãa]o|reserva|pnr)\s*(?:n[º°o.]*)?\s*[:#-]?\s*([A-Z0-9]{6})\b/gi;

/** Datas na ordem em que aparecem: 31/05/2028, 2028-05-31, 31 mai 2028, 31MAY, 31 de maio. */
function dates(text: string, refYear: number): { at: number; v: string }[] {
  const out: { at: number; v: string }[] = [];
  const push = (at: number, y: number, m: number, d: number) => {
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2000 && y <= 2100) out.push({ at, v: `${y}-${pad(m)}-${pad(d)}` });
  };
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) push(m.index!, +m[1], +m[2], +m[3]);
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : refYear;
    push(m.index!, y, +m[2], +m[1]);
  }
  for (const m of text.matchAll(/\b(\d{1,2})\s*(?:de\s+)?([a-zç]{3})[a-zç]*\.?(?:\s*(?:de\s+)?(\d{4}))?/gi)) {
    const mo = MONTHS[m[2].toLowerCase()];
    if (mo) push(m.index!, m[3] ? +m[3] : refYear, mo, +m[1]);
  }
  return out.sort((a, b) => a.at - b.at).filter((x, i, a) => i === 0 || x.at !== a[i - 1].at);
}

export function parseTicket(text: string, refYear = new Date().getFullYear()): ParsedTicket {
  const t = text.replace(/\r/g, '');
  const out: ParsedTicket = {};

  // O código vem em maiúsculas no bilhete; "reserva confirmada" não é localizador.
  const ref = [...t.matchAll(WORD_REF)].find((m) => m[1] === m[1].toUpperCase() && /[A-Z]/.test(m[1]));
  if (ref) out.booking_ref = ref[1];

  const fl = t.match(/(?:\bvoo|\bvôo|\bflight|\bvuelo)\s*(?:n[º°o.]*)?\s*[:#]?\s*([A-Z0-9]{2})\s?-?(\d{1,4})\b/i)
    ?? [...t.matchAll(/\b([A-Z][A-Z0-9]|[0-9][A-Z])\s?(\d{2,4})\b/g)].find((m) => AIRLINES.has(m[1]));
  if (fl) out.flight = `${fl[1].toUpperCase()} ${fl[2]}`;

  const codes: string[] = [];
  for (const m of t.matchAll(/\b([A-Z]{3})\b/g)) if (KNOWN_AIRPORTS.has(m[1]) && codes[codes.length - 1] !== m[1]) codes.push(m[1]);
  const uniq = [...new Set(codes)];
  if (uniq[0]) out.origin_code = uniq[0];
  if (uniq[1]) out.dest_code = uniq[1];

  const ds = dates(t, refYear);
  if (ds[0]) out.depart_date = ds[0].v;
  const later = ds.find((d) => d.v !== ds[0]?.v);
  if (later && ds[0] && later.v > ds[0].v && Date.parse(later.v) - Date.parse(ds[0].v) <= 2 * 86_400_000) out.arrive_date = later.v;

  const times = [...t.matchAll(/\b([01]?\d|2[0-3])[:h]([0-5]\d)\b/g)].map((m) => `${pad(+m[1])}:${m[2]}`);
  if (times[0]) out.depart_time = times[0];
  if (times[1]) out.arrive_time = times[1];
  if (out.depart_time && !out.arrive_date && out.depart_date) out.arrive_date = out.depart_date;

  const seats = [...t.matchAll(/(?:assentos?|poltronas?|seats?)\s*[:#]?\s*((?:\d{1,2}[A-K](?:\s*[,e/]\s*)?)+)/gi)]
    .flatMap((m) => m[1].match(/\d{1,2}[A-K]/gi) ?? []).map((x) => x.toUpperCase());
  if (seats.length) out.seat = [...new Set(seats)].join(' · ');
  return out;
}

/** Quantos campos úteis a leitura achou (para dizer "achei 5 dados" ou cair no preenchimento guiado). */
export const parsedCount = (p: ParsedTicket) => Object.values(p).filter(Boolean).length;
