// Converte os dados FICTÍCIOS do protótipo em TripBundle, para a área de demonstração/QA.
// Nada daqui é gravado no banco nem misturado com viagens reais.
import type {
  Activity, BudgetCategory, BudgetPlan, DocCategory, DocumentRow, Expense, ExpenseShare, InspirationValue, InspirationVote, JournalEntry, Member,
  PackingCategory, PackingItem, Poll, PollOption, PollVote, PoolContribution, Profile, Stay, Stop, Suggestion, SuggestionPayload, Task, Transport,
  TransportMode, Trip, TripBundle, TripPreference,
} from '../../data/types';
import { DICTIONARY } from '../identity/dictionary';
import { DICTIONARY_ACCENT, PERSON_COLORS } from '../identity/accent';
import { categoryKind, splitEqual } from '../money';
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

// Inspirações de exemplo (Diário · Antes). votes[i] é a reação da pessoa i da turma (0 = você).
const INSPIRATIONS: Partial<Record<DemoKey, { stop: number; title: string; place: string | null; body: string; author: number; votes: (InspirationValue | null)[] }[]>> = {
  andes: [
    { stop: 1, title: 'Mercado de San Pedro', place: 'San Pedro, Cusco', body: 'Almoçar no balcão das sopas e provar suco de lúcuma.', author: 1, votes: [null, 2, 1] },
    { stop: 5, title: 'Salar ao amanhecer', place: null, body: 'Sair de madrugada pra ver o sol nascer no espelho d’água.', author: 2, votes: [null, 2, -1] },
    { stop: 1, title: 'Montanha Colorida', place: 'Vinicunca', body: 'Trilha de um dia saindo de Cusco. Passa dos 5.000 m: só depois de aclimatar.', author: 1, votes: [] },
  ],
};

// Enquetes de exemplo. votes[i] = índices das opções que a pessoa i marcou (0 = você).
interface DemoPoll {
  stop: number; target: Poll['target']; question: string; detail: string | null; closes_at: string | null; author: number;
  options: { label: string; detail?: string; price?: number; currency?: string; address?: string }[];
  votes: number[][]; decided?: { option: number; dayOffset: number };
}
const POLLS: Partial<Record<DemoKey, DemoPoll[]>> = {
  andes: [
    {
      stop: 2, target: 'stay', question: 'Onde dormir em Aguas Calientes?', detail: 'A pousada atual ainda não foi reservada. Quem decidir, reserva.',
      closes_at: '2027-01-10T23:59:00-03:00', author: 1,
      options: [
        { label: 'Hostel Pirwa', detail: 'R$ 140 / noite, quarto de 4', price: 140, currency: 'BRL', address: 'Av. Pachacútec, Aguas Calientes' },
        { label: 'Pousada Inti Wasi', detail: 'R$ 240 / noite, café incluso', price: 240, currency: 'BRL', address: 'Calle Imperio de los Incas' },
        { label: 'Casa de família', detail: 'Indicação da Bia, pagamento em dinheiro' },
      ],
      votes: [[], [0], [1]],
    },
    {
      stop: 4, target: 'activity', question: 'Qual passeio em La Paz?', detail: null, closes_at: null, author: 0,
      options: [{ label: 'Teleférico ao pôr do sol', detail: 'Linha vermelha até El Alto' }, { label: 'Vale da Lua' }],
      votes: [[0], [0], [1]], decided: { option: 0, dayOffset: 1 },
    },
  ],
};

// ───── Trilha 2.0: custos, bairros, sugestões e caixa (planning §7, "Demo") ─────
// Valores FICTÍCIOS, em BRL e marcados como estimativa quando a turma não confirmou.
// A Andes bate com o canvas: R$ 6.470 por pessoa (R$ 19.410 para 3) e R$ 9.360 juntados.
const TRANSPORT_PRICE: Record<TransportMode, number> = { plane: 1450, train: 420, bus: 110, car: 150, boat: 90, walk: 0, other: 120 };
const STAY_NIGHT: Partial<Record<DemoKey, number[]>> = { andes: [330, 290, 360, 240, 270, 300] };
const AREA: Partial<Record<DemoKey, (string | null)[]>> = { andes: ['Miraflores', 'San Blas', null, null, 'Sopocachi', null] };
// Custo por pessoa de atividades, casado pelo título.
const ACTIVITY_COST: [RegExp, number][] = [
  [/Machu Picchu na primeira/i, 320], [/Vale Sagrado/i, 180], [/Uros/i, 60], [/Taquile/i, 140], [/Teleférico/i, 25],
  [/Salar, ilha/i, 650], [/Valle de la Luna|Estrada da Morte/i, 90], [/termas/i, 40],
];
// Atividades que a demo tira do plano para sobrar um dia vazio (a sugestão ocupa).
const DROP_PLAN: Partial<Record<DemoKey, RegExp>> = { andes: /Montanha Colorida/i };
// Previsto da turma toda por categoria (substitui o do protótipo).
const PLANNED: Partial<Record<DemoKey, Record<string, number>>> = { andes: { Transporte: 6540, Hospedagem: 4950, Passeios: 3720, Comida: 4200 } };
// Aportes no caixa: [pessoa, valor, data]
const POOL: Partial<Record<DemoKey, [number, number, string][]>> = {
  andes: [[0, 2000, '2026-09-10'], [1, 2000, '2026-09-12'], [2, 1500, '2026-09-20'], [0, 1900, '2026-10-10'], [1, 1240, '2026-10-15'], [2, 720, '2026-10-28']],
};
interface DemoSuggestion { stop: number; kind: Suggestion['kind']; payload: SuggestionPayload }
const SUGGESTIONS: Partial<Record<DemoKey, DemoSuggestion[]>> = {
  andes: [
    { stop: 1, kind: 'activity', payload: { title: 'Montanha Colorida, saindo de Cusco', why: 'Dia inteiro, passa dos 5.000 m: melhor depois de aclimatar. A Bia já salvou no Diário.', duration: 'dia inteiro', day_fit: 'dia_todo', effort: 'puxado', cost_low: 12000, cost_high: 18000, currency: 'BRL', photo_query: 'Vinicunca' } },
    { stop: 0, kind: 'activity', payload: { title: 'Circuito Mágico del Agua', why: 'Fontes iluminadas no Parque de la Reserva, bom pra uma noite leve em Lima.', duration: '2h', day_fit: 'noite', effort: 'leve', cost_low: 1000, cost_high: 1500, currency: 'BRL', photo_query: 'Circuito Mágico del Agua' } },
    { stop: 4, kind: 'activity', payload: { title: 'Mirador Killi Killi', why: 'Vista da cidade inteira no fim da tarde, perto do centro.', duration: '1h30', day_fit: 'tarde', effort: 'leve', cost_low: 0, cost_high: 0, currency: 'BRL', photo_query: 'Killi Killi La Paz' } },
    { stop: 2, kind: 'area', payload: { title: 'Ficar perto da estação em Aguas Calientes', why: 'O trem chega e o ônibus para as ruínas sai dali: dá pra fazer tudo a pé.', cost_low: 25000, cost_high: 40000, currency: 'BRL', photo_query: 'Aguas Calientes' } },
  ],
};
const PREFERENCES: Partial<Record<DemoKey, Record<string, unknown>[]>> = {
  andes: [{ vibe: ['natureza', 'história'], ritmo: 'moderado' }, { vibe: ['natureza', 'comida'], ritmo: 'intenso' }, { vibe: ['história'], ritmo: 'leve' }],
};
// Item da mala → índice da pessoa que leva.
const ASSIGNEE: [RegExp, number][] = [[/Adaptador/i, 1], [/Kit primeiros/i, 2], [/Power bank/i, 0], [/Lanterna/i, 2]];

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
    created_at: '2026-09-01T12:00:00.000Z', accent: DICTIONARY_ACCENT[key] ?? null, budget_plan: null,
  };

  const members: Member[] = people.map((p, i) => ({ trip_id: tripId, user_id: p.uid, role: i === 0 ? 'organizer' : 'editor', joined_at: now }));
  const profiles: Profile[] = people.map((p, i) => ({ ...base, id: p.uid, display_name: p.name, color: PERSON_COLORS[i % PERSON_COLORS.length] }));

  const stops: Stop[] = [];
  const transports: Transport[] = [];
  const stays: Stay[] = [];
  const activities: Activity[] = [];
  const drop = DROP_PLAN[key];
  raw.stops.forEach((s, i) => {
    const [a, b] = parseSpan(s.dates, year);
    const mode = MODE[s.tmode] ?? 'other';
    const night = STAY_NIGHT[key]?.[i];
    const sid = id(key, 'stop', i);
    const alt = s.meta.match(/altitude\s+([\d.]+)\s*m/i);
    const c = COORDS[s.city] ?? null;
    stops.push({
      ...base, id: sid, trip_id: tripId, position: i, name: s.city, country: s.country, arrival_date: a, departure_date: b, tz: null,
      altitude_m: alt ? Number(alt[1].replace(/\./g, '')) : null, lat: c?.[0] ?? null, lng: c?.[1] ?? null,
      arrival_mode: MODE[s.tmode] ?? 'other', color: null, notes: null, code: s.code, meta: s.meta,
      tip: s.tip ? { text: s.tip, kind: 'outro', by: 'ai', generated_at: now } : null,
      area: AREA[key]?.[i] ?? null, photo: null,
    });
    const prevLeg = i > 0 ? raw.stops[i - 1].leg : '';
    const dur = prevLeg.match(/(\d+)h(\d+)?|(\d+)\s*min/);
    transports.push({
      ...base, id: id(key, 'tr', i), trip_id: tripId, stop_id: sid, mode: MODE[s.tmode] ?? 'other', origin_code: s.tfrom, origin_name: null,
      dest_code: s.tto, dest_name: s.city, depart_date: a, depart_time: /^\d\d:\d\d$/.test(s.tdep) ? s.tdep : null, depart_tz: null,
      arrive_date: a, arrive_time: /^\d\d:\d\d$/.test(s.tarr) ? s.tarr : null, arrive_tz: null, booking_ref: null, seat: null, notes: null,
      duration_min: dur ? (dur[3] ? Number(dur[3]) : Number(dur[1]) * 60 + Number(dur[2] ?? 0)) : null, document_id: null,
      price_cents: key === 'andes' ? TRANSPORT_PRICE[mode] * 100 : null, price_currency: key === 'andes' ? 'BRL' : null, price_is_estimate: mode !== 'plane',
    });
    stays.push({
      ...base, id: id(key, 'stay', i), trip_id: tripId, stop_id: sid, name: s.stay, address: null, checkin_date: a, checkin_time: null,
      checkout_date: b, checkout_time: null, status: s.stayStatus === 'Sem reserva' ? 'pending' : 'booked', notes: null, document_id: null, suggested_by: null, from_poll_id: null,
      price_cents: night ? night * 100 : null, price_currency: night ? 'BRL' : null, price_is_estimate: s.stayStatus === 'Sem reserva', link_url: null,
    });
    s.plan.forEach((p, j) => {
      if (drop?.test(p)) return;
      const m = p.match(/^(\d{1,2})\s+[A-ZÁ]{3}\s+·\s+(.*)$/);
      const cost = key === 'andes' ? ACTIVITY_COST.find(([re]) => re.test(p))?.[1] : undefined;
      activities.push({
        ...base, id: id(key, 'act', `${i}${j}`), trip_id: tripId, stop_id: sid,
        day: m ? `${a.slice(0, 8)}${m[1].padStart(2, '0')}` : addDays(a, Math.min(j, Math.max(0, s.n - 1))),
        time: null, title: m ? m[2] : p, notes: null, position: j, suggested_by: null, from_entry_id: null, from_poll_id: null,
        cost_cents: cost != null ? cost * 100 : null, cost_currency: cost != null ? 'BRL' : null, cost_is_estimate: true, photo: null,
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
      valid_until: null, notes: null, status: 'ready', subtitle: d.sub, classified_by: 'user', ai_confidence: null, is_shot: false, encrypted: false,
    };
  });

  const packingCategories: PackingCategory[] = raw.groups.map((g, i) => ({ ...base, id: id(key, 'pc', i), trip_id: tripId, name: g.name, position: i }));
  const packingItems: PackingItem[] = raw.groups.flatMap((g, i) =>
    g.items.map((it, j) => ({
      ...base, id: id(key, 'pi', `${i}${j}`), trip_id: tripId, category_id: packingCategories[i].id, label: it.label, done: it.on,
      done_by: null, suggestion_reason: it.ai ? 'Sugerido para as paradas desta trilha (exemplo).' : null, position: j, suggested_by: it.ai ? ('ai' as const) : null,
      assignee_id: (() => { const hit = ASSIGNEE.find(([re]) => re.test(it.label)); return hit ? people[hit[1]]?.uid ?? null : null; })(),
    })),
  );

  const budgetCategories: BudgetCategory[] = raw.budget.cats.map(([name, , planned], i) => ({
    ...base, id: id(key, 'bc', i), trip_id: tripId, name, color: ['#8E9BFF', '#FF6B3D', '#4FC08D', '#E3E6EB'][i % 4],
    planned: PLANNED[key]?.[name] ?? planned, position: i, kind: categoryKind({ name }),
  }));
  if (PLANNED[key]) trip.budget_total = Object.values(PLANNED[key]!).reduce((a, v) => a + v, 0);
  const expenses: Expense[] = [];
  const expenseShares: ExpenseShare[] = [];
  const catOf = (kind: string) => budgetCategories.find((c) => c.kind === kind)?.id ?? null;
  // Andes: gastos já feitos antes da viagem, ligados aos itens que pagam (a maioria pelo caixa).
  const LINKED: { desc: string; cents: number; kind: string; link: Partial<Pick<Expense, 'activity_id' | 'stay_id' | 'transport_id'>>; pool: boolean; payer: number }[] = key === 'andes'
    ? [
      { desc: 'Voo GRU → LIM', cents: 435000, kind: 'transporte', link: { transport_id: transports[0]?.id }, pool: true, payer: 0 },
      { desc: 'Hostel em San Blas', cents: 116000, kind: 'hospedagem', link: { stay_id: stays[1]?.id }, pool: true, payer: 1 },
      { desc: 'Ingressos Machu Picchu', cents: 96000, kind: 'passeios', link: { activity_id: activities.find((a) => /Machu Picchu na primeira/.test(a.title))?.id }, pool: false, payer: 2 },
    ]
    : [];
  LINKED.forEach((l, i) => {
    const eid = id(key, 'lex', i);
    const payer = people[l.payer].uid;
    const amount = l.cents / 100;
    expenses.push({
      ...base, id: eid, trip_id: tripId, description: l.desc, category_id: catOf(l.kind), stop_id: null, payer_id: payer, paid_from_pool: l.pool,
      amount, currency: 'BRL', rate_to_base: 1, rate_source: 'Mesma moeda', rate_date: '2026-10-20', rate_is_manual: false, base_amount: amount,
      spent_on: '2026-10-20', created_by: payer, activity_id: null, stay_id: null, transport_id: null, ...l.link,
    });
    for (const sh of splitEqual(l.cents, people.map((p) => p.uid))) expenseShares.push({ expense_id: eid, trip_id: tripId, ...sh });
  });
  if (!LINKED.length) raw.budget.cats.forEach(([, spent], i) => {
    const eid = id(key, 'ex', i);
    const payer = people[i % people.length].uid;
    expenses.push({
      ...base, id: eid, trip_id: tripId, description: `${raw.budget.cats[i][0]} (exemplo)`, category_id: budgetCategories[i].id,
      stop_id: stops[i % stops.length]?.id ?? null, payer_id: payer, paid_from_pool: false, amount: spent, currency: 'BRL', rate_to_base: 1, rate_source: 'Mesma moeda',
      rate_date: raw.obDates[0], rate_is_manual: false, base_amount: spent, spent_on: raw.obDates[0], created_by: payer,
    });
    for (const sh of splitEqual(Math.round(spent * 100), people.map((p) => p.uid))) expenseShares.push({ expense_id: eid, trip_id: tripId, ...sh });
  });

  const poolContributions: PoolContribution[] = (POOL[key] ?? []).map(([who, value, day], i) => ({
    id: id(key, 'pool', i), trip_id: tripId, user_id: people[who].uid, kind: 'deposit', amount_cents: value * 100, contributed_on: day,
    note: null, created_by: people[who].uid, created_at: `${day}T12:00:00.000Z`,
  }));

  const suggestions: Suggestion[] = (SUGGESTIONS[key] ?? []).map((sg, i) => ({
    ...base, id: id(key, 'sug', i), trip_id: tripId, stop_id: stops[sg.stop]?.id ?? null, kind: sg.kind, day: null, payload: sg.payload,
    status: 'new', source: 'ai', acted_by: null, acted_at: null,
  }));
  const tripPreferences: TripPreference[] = (PREFERENCES[key] ?? []).map((answers, i) => ({ trip_id: tripId, user_id: people[i]?.uid ?? DEMO_USER, answers, updated_at: now }));
  if (key === 'andes') {
    const plan: BudgetPlan = {
      style: 'equilibrado', pace: 'moderado', daily_food_cents: 9000,
      snapshot: { stops: stops.map((s) => ({ id: s.id, nights: Math.round((Date.parse(s.departure_date) - Date.parse(s.arrival_date)) / 86_400_000) })), people: people.length, at: now },
      updated_at: now,
    };
    trip.budget_plan = plan;
  }

  const LINK = { doc: 'documentos', alert: 'documentos', bag: 'mala', bed: 'roteiro', users: 'turma' } as const;
  const tasks: Task[] = raw.rows.map((r, i) => ({
    ...base, id: id(key, 'task', i), trip_id: tripId, title: r[1], detail: r[2], assignee_id: null, due_date: null,
    status: 'todo', created_by: DEMO_USER, link: LINK[r[0] as keyof typeof LINK] ?? 'roteiro', source: r[4] ? 'ai' : 'user', alert_key: null, dismissed: false,
  }));

  const journalEntries: JournalEntry[] = [];
  const inspirationVotes: InspirationVote[] = [];
  (INSPIRATIONS[key] ?? []).forEach((ins, i) => {
    const eid = id(key, 'insp', i);
    const author = people[ins.author] ?? people[0];
    journalEntries.push({
      ...base, id: eid, trip_id: tripId, stop_id: stops[ins.stop]?.id ?? null, author_id: author.uid, phase: 'antes', entry_date: null,
      title: ins.title, body: ins.body, link_url: null, favorite: false, kind: 'inspiracao', place_name: ins.place,
    });
    ins.votes.forEach((value, j) => {
      if (value != null && people[j]) inspirationVotes.push({ entry_id: eid, trip_id: tripId, user_id: people[j].uid, value, updated_at: now });
    });
  });

  const polls: Poll[] = [];
  const pollOptions: PollOption[] = [];
  const pollVotes: PollVote[] = [];
  (POLLS[key] ?? []).forEach((dp, i) => {
    const pid = id(key, 'poll', i);
    const st = stops[dp.stop];
    const author = (people[dp.author] ?? people[0]).uid;
    const optIds = dp.options.map((_, j) => id(key, 'popt', `${i}${j}`));
    dp.options.forEach((o, j) => pollOptions.push({
      id: optIds[j], poll_id: pid, trip_id: tripId, label: o.label, detail: o.detail ?? null, link_url: null, price: o.price ?? null,
      currency: o.currency ?? null, address: o.address ?? null, position: j, created_by: author, created_at: now,
    }));
    dp.votes.forEach((marks, u) => {
      if (people[u]) for (const j of marks) pollVotes.push({ poll_id: pid, option_id: optIds[j], trip_id: tripId, user_id: people[u].uid, created_at: now });
    });
    polls.push({
      ...base, id: pid, trip_id: tripId, question: dp.question, detail: dp.detail, target: dp.target, stop_id: st?.id ?? null, multi: false,
      closes_at: dp.closes_at, status: dp.decided ? 'closed' : 'open', decided_option_id: dp.decided ? optIds[dp.decided.option] : null,
      decided_by: dp.decided ? DEMO_USER : null, decided_at: dp.decided ? now : null, created_by: author,
    });
    if (dp.decided && st && dp.target === 'activity') {
      const day = addDays(st.arrival_date, dp.decided.dayOffset);
      const o = dp.options[dp.decided.option];
      activities.push({
        ...base, id: id(key, 'pact', i), trip_id: tripId, stop_id: st.id, day, time: null, title: o.label, notes: o.detail ?? null,
        position: activities.filter((a) => a.stop_id === st.id && a.day === day).length, suggested_by: null, from_entry_id: null, from_poll_id: pid,
      });
    }
  });

  return {
    trip, members, profiles, stops, transports, stays, activities, documents, documentShares: [], documentKeys: [], publicKeys: [], packingCategories, packingItems,
    tasks, budgetCategories, expenses, expenseShares, settlements: [], poolContributions, journalEntries, journalPhotos: [], inspirationVotes, polls, pollOptions, pollVotes, suggestions, tripPreferences, offlinePrefs: [], retro: null,
    fetchedAt: now,
  };
}

/** Moedas locais do exemplo (o conversor real usa cotação ao vivo). */
export function demoCurrencies(key: DemoKey): { code: string; symbol: string }[] {
  return DEMO_RAW[key].budget.cur.map(([code, symbol]) => ({ code, symbol }));
}
