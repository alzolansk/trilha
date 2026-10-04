// Converte os dados FICTÍCIOS do protótipo em TripBundle, para a área de demonstração/QA.
// Nada daqui é gravado no banco nem misturado com viagens reais.
import type {
  Activity, BudgetCategory, DocCategory, DocumentRow, Expense, ExpenseShare, Member, PackingCategory,
  PackingItem, Profile, Stay, Stop, Task, Transport, TransportMode, Trip, TripBundle,
} from '../../data/types';
import { DICTIONARY } from '../identity/dictionary';
import { splitEqual } from '../money';
import { addDays } from '../time';
import { DEMO_RAW } from './demo.data';

export const DEMO_KEYS = ['andes', 'japao', 'marrocos', 'islandia'] as const;
export type DemoKey = (typeof DEMO_KEYS)[number];
export const DEMO_USER = '00000000-0000-4000-8000-0000000000d0';

// Coordenadas públicas aproximadas das cidades do exemplo (para o mapa da demonstração).
const COORDS: Record<string, [number, number]> = {
  Lima: [-12.046, -77.043], Cusco: [-13.532, -71.967], 'Machu Picchu': [-13.163, -72.545], Puno: [-15.84, -70.022],
  'La Paz': [-16.5, -68.15], Uyuni: [-20.46, -66.825], Tóquio: [35.68, 139.76], Hakone: [35.232, 139.107],
  Kyoto: [35.011, 135.768], Quioto: [35.011, 135.768], Nara: [34.685, 135.805], Osaka: [34.693, 135.502],
  Marrakech: [31.629, -7.981], 'Aït Benhaddou': [31.047, -7.13], Merzouga: [31.08, -4.013], Fez: [34.033, -5.0],
  Chefchaouen: [35.171, -5.27], Reykjavík: [64.146, -21.942], Vík: [63.419, -19.006], Höfn: [64.25, -15.21],
  'Jökulsárlón': [64.048, -16.179], Akureyri: [65.683, -18.09],
};

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const now = '2026-10-01T12:00:00.000Z';
const id = (k: string, kind: string, i: number | string) => {
  const h = Array.from(`${k}:${kind}:${i}`).reduce((a, c) => (Math.imul(a, 31) + c.charCodeAt(0)) >>> 0, 7);
  return `d${h.toString(16).padStart(7, '0').slice(0, 7)}-0000-4000-8000-${String(i).padStart(12, '0').slice(-12)}`;
};
const base = { version: 1, created_at: now, updated_at: now };

function parseSpan(span: string, year: number): [string, string] {
  const m = span.match(/(\d{1,2})\s*([a-zç]{3})?\s*→\s*(\d{1,2})\s*([a-zç]{3})/i);
  if (!m) return [`${year}-01-01`, `${year}-01-02`];
  const mo2 = MONTHS.indexOf(m[4].toLowerCase()) + 1;
  const mo1 = m[2] ? MONTHS.indexOf(m[2].toLowerCase()) + 1 : mo2;
  const p = (n: number) => String(n).padStart(2, '0');
  return [`${year}-${p(mo1)}-${p(+m[1])}`, `${year}-${p(mo2)}-${p(+m[3])}`];
}

const MODE: Record<string, TransportMode> = { VOO: 'plane', 'AVIÃO': 'plane', TREM: 'train', 'TREM-BALA': 'train', 'ÔNIBUS': 'bus', CARRO: 'car', BARCO: 'boat' };
const CAT: Record<string, DocCategory> = { Passagens: 'passagem', Identidade: 'identidade', Reservas: 'reserva', Ingressos: 'ingresso', Seguro: 'seguro', Outros: 'outro' };

export function buildDemoBundle(key: DemoKey): TripBundle {
  const raw = DEMO_RAW[key];
  const identity = DICTIONARY[key];
  const tripId = id(key, 'trip', 0);
  const year = Number(raw.obDates[0].slice(0, 4));
  const people = raw.budget.people.map(([ini, name], i) => ({ uid: i === 0 ? DEMO_USER : id(key, 'user', i), ini, name }));

  const trip: Trip = {
    ...base, id: tripId, title: raw.dest, tagline: null, destinations: [raw.dest], start_date: raw.obDates[0], end_date: raw.obDates[1],
    departure_at: raw.target, departure_tz: 'America/Sao_Paulo', home_tz: 'America/Sao_Paulo', base_currency: 'BRL',
    budget_total: raw.budget.prev, cover_path: null, created_by: DEMO_USER, origin: raw.dateLabel.split('·')[1]?.trim().split(' ')[0] ?? null,
    style: 'Mochilão', return_at: null, identity, identity_version: 1,
  };

  const members: Member[] = people.map((p, i) => ({ trip_id: tripId, user_id: p.uid, role: i === 0 ? 'organizer' : 'editor', joined_at: now }));
  const profiles: Profile[] = people.map((p, i) => ({ ...base, id: p.uid, display_name: p.name, color: [identity.palette.acc, identity.palette.acc2, identity.palette.acc3][i % 3] }));

  const stops: Stop[] = [];
  const transports: Transport[] = [];
  const stays: Stay[] = [];
  const activities: Activity[] = [];
  raw.stops.forEach((s, i) => {
    const [a, b] = parseSpan(s.dates, year);
    const sid = id(key, 'stop', i);
    const alt = s.meta.match(/altitude\s+([\d.]+)\s*m/i);
    const c = COORDS[s.city] ?? null;
    stops.push({
      ...base, id: sid, trip_id: tripId, position: i, name: s.city, country: s.country, arrival_date: a, departure_date: b, tz: null,
      altitude_m: alt ? Number(alt[1].replace(/\./g, '')) : null, lat: c?.[0] ?? null, lng: c?.[1] ?? null,
      arrival_mode: MODE[s.tmode] ?? 'other', color: null, notes: null, code: s.code, meta: s.meta,
      tip: s.tip ? { text: s.tip, kind: 'outro', by: 'ai', generated_at: now } : null,
    });
    const prevLeg = i > 0 ? raw.stops[i - 1].leg : '';
    const dur = prevLeg.match(/(\d+)h(\d+)?|(\d+)\s*min/);
    transports.push({
      ...base, id: id(key, 'tr', i), trip_id: tripId, stop_id: sid, mode: MODE[s.tmode] ?? 'other', origin_code: s.tfrom, origin_name: null,
      dest_code: s.tto, dest_name: s.city, depart_date: a, depart_time: /^\d\d:\d\d$/.test(s.tdep) ? s.tdep : null, depart_tz: null,
      arrive_date: a, arrive_time: /^\d\d:\d\d$/.test(s.tarr) ? s.tarr : null, arrive_tz: null, booking_ref: null, seat: null, notes: null,
      duration_min: dur ? (dur[3] ? Number(dur[3]) : Number(dur[1]) * 60 + Number(dur[2] ?? 0)) : null, document_id: null,
    });
    stays.push({
      ...base, id: id(key, 'stay', i), trip_id: tripId, stop_id: sid, name: s.stay, address: null, checkin_date: a, checkin_time: null,
      checkout_date: b, checkout_time: null, status: s.stayStatus === 'Sem reserva' ? 'pending' : 'booked', notes: null, document_id: null, suggested_by: null,
    });
    s.plan.forEach((p, j) => {
      const m = p.match(/^(\d{1,2})\s+[A-ZÁ]{3}\s+·\s+(.*)$/);
      activities.push({
        ...base, id: id(key, 'act', `${i}${j}`), trip_id: tripId, stop_id: sid,
        day: m ? `${a.slice(0, 8)}${m[1].padStart(2, '0')}` : addDays(a, Math.min(j, Math.max(0, s.n - 1))),
        time: null, title: m ? m[2] : p, notes: null, position: j, suggested_by: null,
      });
    });
  });

  const documents: DocumentRow[] = raw.docs.map((d, i) => {
    const [ext, size] = d.meta.split('·').map((x) => x.trim());
    const mb = size.includes('MB') ? parseFloat(size.replace(',', '.')) * 1048576 : parseFloat(size) * 1024;
    const stop = stops.find((s) => d.sub.startsWith(s.name) || d.title.includes(s.name));
    return {
      ...base, id: id(key, 'doc', i), trip_id: tripId, owner_id: DEMO_USER, title: d.title, category: CAT[d.cat] ?? 'outro',
      visibility: 'trip', stop_id: stop?.id ?? null, storage_path: `demo/${key}/${i}`, preview_path: null, original_name: `${d.title}.${ext.toLowerCase()}`,
      mime: ext === 'PDF' ? 'application/pdf' : ext === 'PNG' ? 'image/png' : 'image/jpeg', size_bytes: Math.round(mb), valid_from: null,
      valid_until: null, notes: null, status: 'ready', subtitle: d.sub, classified_by: 'user', ai_confidence: null, is_shot: false,
    };
  });

  const packingCategories: PackingCategory[] = raw.groups.map((g, i) => ({ ...base, id: id(key, 'pc', i), trip_id: tripId, name: g.name, position: i }));
  const packingItems: PackingItem[] = raw.groups.flatMap((g, i) =>
    g.items.map((it, j) => ({
      ...base, id: id(key, 'pi', `${i}${j}`), trip_id: tripId, category_id: packingCategories[i].id, label: it.label, done: it.on,
      done_by: null, suggestion_reason: it.ai ? 'Sugerido para as paradas desta trilha (exemplo).' : null, position: j, suggested_by: it.ai ? ('ai' as const) : null,
    })),
  );

  const budgetCategories: BudgetCategory[] = raw.budget.cats.map(([name, , planned], i) => ({
    ...base, id: id(key, 'bc', i), trip_id: tripId, name, color: [identity.palette.acc, identity.palette.acc2, identity.palette.acc3, identity.palette.deep][i % 4], planned, position: i,
  }));
  const expenses: Expense[] = [];
  const expenseShares: ExpenseShare[] = [];
  raw.budget.cats.forEach(([, spent], i) => {
    const eid = id(key, 'ex', i);
    const payer = people[i % people.length].uid;
    expenses.push({
      ...base, id: eid, trip_id: tripId, description: `${raw.budget.cats[i][0]} (exemplo)`, category_id: budgetCategories[i].id,
      stop_id: stops[i % stops.length]?.id ?? null, payer_id: payer, amount: spent, currency: 'BRL', rate_to_base: 1, rate_source: 'Mesma moeda',
      rate_date: raw.obDates[0], rate_is_manual: false, base_amount: spent, spent_on: raw.obDates[0], created_by: payer,
    });
    for (const sh of splitEqual(Math.round(spent * 100), people.map((p) => p.uid))) expenseShares.push({ expense_id: eid, trip_id: tripId, ...sh });
  });

  const LINK = { doc: 'documentos', alert: 'documentos', bag: 'mala', bed: 'roteiro', users: 'turma' } as const;
  const tasks: Task[] = raw.rows.map((r, i) => ({
    ...base, id: id(key, 'task', i), trip_id: tripId, title: r[1], detail: r[2], assignee_id: null, due_date: null,
    status: 'todo', created_by: DEMO_USER, link: LINK[r[0] as keyof typeof LINK] ?? 'roteiro', source: r[4] ? 'ai' : 'user', alert_key: null, dismissed: false,
  }));

  return {
    trip, members, profiles, stops, transports, stays, activities, documents, documentShares: [], packingCategories, packingItems,
    tasks, budgetCategories, expenses, expenseShares, settlements: [], journalEntries: [], journalPhotos: [], offlinePrefs: [], retro: null,
    fetchedAt: now,
  };
}

/** Moedas locais do exemplo (o conversor real usa cotação ao vivo). */
export function demoCurrencies(key: DemoKey): { code: string; symbol: string }[] {
  return DEMO_RAW[key].budget.cur.map(([code, symbol]) => ({ code, symbol }));
}
