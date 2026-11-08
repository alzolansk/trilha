'use client';
// Fonte de dados da demonstração: tudo em memória, some ao recarregar. Serve para
// explorar as 4 identidades e para QA, sem tocar em dados reais.
import { buildDemoBundle, DEMO_USER, type DemoKey } from '../lib/demo/build';
import { ConflictError, type TripSource } from './source';
import { BUNDLE_KEYS, type TableName, type TripBundle } from './types';
import type { BudgetWrite } from './budgetActions';

const stores = new Map<string, TripBundle>();

function listFor(b: TripBundle, table: TableName): Record<string, unknown>[] | null {
  const k = BUNDLE_KEYS[table];
  if (!k) return null;
  return (b as unknown as Record<string, Record<string, unknown>[]>)[k];
}

const matches = (row: Record<string, unknown>, m: Record<string, unknown>) => Object.entries(m).every(([k, v]) => row[k] === v);
const fail = (message: string, code: string) => Object.assign(new Error(message), { code });

// Valores padrão do banco para linhas que o app insere sem informar tudo.
const DEFAULTS: Partial<Record<TableName, Record<string, unknown>>> = {
  polls: { detail: null, target: 'free', stop_id: null, multi: false, closes_at: null, status: 'open', decided_option_id: null, decided_by: null, decided_at: null, created_by: DEMO_USER },
  poll_options: { detail: null, link_url: null, price: null, currency: null, address: null, position: 0, created_by: DEMO_USER },
  suggestions: { stop_id: null, day: null, status: 'new', source: 'ai', acted_by: null, acted_at: null },
  trip_preferences: { user_id: DEMO_USER, answers: {} },
};

// Mesmo carimbo que o gatilho stamp_suggestion faz no banco.
function stampSuggestion(row: Record<string, unknown>, prev?: Record<string, unknown>) {
  if (row.status !== undefined && row.status !== (prev?.status ?? 'new')) {
    row.acted_by = DEMO_USER;
    row.acted_at = new Date().toISOString();
  }
}

export function createDemoSource(key: DemoKey): TripSource {
  if (!stores.has(key)) stores.set(key, buildDemoBundle(key));
  const b = () => stores.get(key)!;
  const listeners = new Set<(t: string) => void>();
  const emit = (t: string) => setTimeout(() => listeners.forEach((l) => l(t)), 0);
  const stamp = () => new Date().toISOString();

  return {
    kind: 'demo',
    tripId: b().trip.id,
    userId: DEMO_USER,
    async load() {
      return structuredClone(b());
    },
    async insert(table, row) {
      const list = listFor(b(), table);
      if (table === 'poll_options') {
        const poll = b().polls.find((p) => p.id === row.poll_id);
        if (poll?.status === 'closed') throw fail('Enquete encerrada', 'P0001');
        if (b().pollOptions.filter((o) => o.poll_id === row.poll_id).length >= 6) throw fail('No máximo 6 opções por enquete', '22023');
      }
      const full = { id: crypto.randomUUID(), trip_id: b().trip.id, version: 1, created_at: stamp(), updated_at: stamp(), ...DEFAULTS[table], ...row };
      if (table === 'suggestions') stampSuggestion(full);
      if (list) list.push(full);
      emit(table);
      return full as never;
    },
    async update(table, id, patch, version) {
      if (table === 'trips') {
        if (version != null && b().trip.version !== version) throw new ConflictError();
        Object.assign(b().trip, patch, { version: b().trip.version + 1, updated_at: stamp() });
        emit(table);
        return structuredClone(b().trip) as never;
      }
      const list = listFor(b(), table) ?? [];
      const row = list.find((r) => r.id === id);
      if (!row) throw new Error('Item não encontrado.');
      if (version != null && row.version !== version) throw new ConflictError();
      if (table === 'suggestions') stampSuggestion(patch, row);
      Object.assign(row, patch, { version: Number(row.version ?? 1) + 1, updated_at: stamp() });
      emit(table);
      return structuredClone(row) as never;
    },
    async updateWhere(table, m, patch) {
      for (const row of listFor(b(), table) ?? []) if (matches(row, m)) Object.assign(row, patch);
      emit(table);
    },
    async upsert(table, row, onConflict) {
      const list = listFor(b(), table);
      if (!list) return;
      const keys = onConflict.split(',').map((s) => s.trim());
      const hit = list.find((r) => keys.every((k) => r[k] === row[k]));
      if (hit) Object.assign(hit, row);
      else list.push({ ...row });
      emit(table);
    },
    async remove(table, m) {
      const bb = b();
      if (table === 'poll_options') {
        for (const o of bb.pollOptions.filter((x) => matches(x as unknown as Record<string, unknown>, m))) {
          if (bb.polls.find((p) => p.id === o.poll_id)?.status === 'closed') throw fail('Enquete encerrada', 'P0001');
          if (bb.pollVotes.some((v) => v.option_id === o.id)) throw fail('Esta opção já tem votos', 'P0001');
        }
      }
      if (table === 'polls') {
        // cascata do banco: opções e votos saem junto
        const gone = new Set(bb.polls.filter((p) => matches(p as unknown as Record<string, unknown>, m)).map((p) => p.id));
        bb.pollOptions = bb.pollOptions.filter((o) => !gone.has(o.poll_id));
        bb.pollVotes = bb.pollVotes.filter((v) => !gone.has(v.poll_id));
      }
      const LINK = { activities: 'activity_id', stays: 'stay_id', transports: 'transport_id' } as const;
      if (table in LINK) {
        // on delete set null: o gasto fica, só perde o vínculo
        const col = LINK[table as keyof typeof LINK];
        const gone = new Set((listFor(bb, table) ?? []).filter((r) => matches(r, m)).map((r) => r.id));
        for (const e of bb.expenses) if (e[col] && gone.has(e[col]!)) e[col] = null;
      }
      const list = listFor(b(), table);
      if (list) {
        for (let i = list.length - 1; i >= 0; i--) if (matches(list[i], m)) list.splice(i, 1);
      }
      emit(table);
    },
    async rpc(fn, args) {
      if (fn === 'close_budget') {
        const p = args as unknown as BudgetWrite;
        const bb = structuredClone(b());
        if (bb.trip.id !== p.p_trip || bb.trip.version !== p.p_version) throw new ConflictError('A trilha mudou. Reabra o orçamento.');
        for (const t of p.p_transports) {
          const row = bb.transports.find((x) => x.id === t.id);
          if (!row || row.version !== t.version) throw new ConflictError('Um trecho mudou. Reabra o orçamento.');
          Object.assign(row, { price_cents: t.cents, price_currency: bb.trip.base_currency, price_is_estimate: false, version: row.version + 1 });
        }
        for (const c of p.p_categories) {
          const row = bb.budgetCategories.find((x) => x.id === c.id);
          if (c.version != null && (!row || row.version !== c.version)) throw new ConflictError('Uma categoria mudou. Reabra o orçamento.');
          if (row) Object.assign(row, { planned: c.planned, kind: c.kind, version: row.version + 1 });
          else bb.budgetCategories.push({ ...c, trip_id: bb.trip.id, version: 1, created_at: stamp(), updated_at: stamp() } as TripBundle['budgetCategories'][number]);
        }
        bb.trip.budget_plan = p.p_plan; bb.trip.version++;
        if (p.p_question && !bb.polls.some((x) => x.question === p.p_question && x.status === 'open' && x.target === 'free')) {
          const id = crypto.randomUUID();
          bb.polls.push({ ...DEFAULTS.polls, id, trip_id: bb.trip.id, question: p.p_question, created_at: stamp(), updated_at: stamp(), version: 1 } as TripBundle['polls'][number]);
          for (const [position, label] of ['Sim', 'Ajustar'].entries()) bb.pollOptions.push({ id: crypto.randomUUID(), trip_id: bb.trip.id, poll_id: id, label, position, detail: null, link_url: null, price: null, currency: null, address: null, created_by: DEMO_USER, created_at: stamp() });
        }
        stores.set(key, bb); emit('trips'); return undefined as never;
      }
      if (fn === 'apply_onboarding_route') {
        // Mesmas regras de supabase/migrations/…0010_onboarding.sql (e stay_base da …0011)
        const bb = structuredClone(b());
        if (bb.trip.id !== args.p_trip || bb.trip.version !== args.p_version) throw fail('A viagem mudou em outra tela. Recarregue para continuar.', 'P0001');
        const r = args.p_route as { stops?: Record<string, unknown>[]; legs?: Record<string, unknown>[]; suggestions?: Record<string, unknown>[]; budget_plan?: unknown; onboarding?: unknown };
        if (!Array.isArray(r?.stops) || !r.stops.length) throw fail('Roteiro inválido', '22023');
        if (bb.stops.length) {
          if (!args.p_replace) throw fail('Já existe um roteiro nesta trilha.', 'P0002');
          if (bb.expenses.some((e) => e.activity_id || e.stay_id || e.transport_id)) throw fail('O roteiro atual tem gastos ligados a trechos, hospedagens ou passeios. Ajuste pelo Roteiro.', 'P0001');
          for (const d of bb.documents) d.stop_id = null;
          for (const j of bb.journalEntries) j.stop_id = null;
          for (const p of bb.polls) (p as { stop_id?: string | null }).stop_id = null;
          const gone = new Set(bb.stops.map((x) => x.id));
          bb.stops = []; bb.transports = []; bb.stays = [];
          bb.activities = bb.activities.filter((x) => !gone.has(x.stop_id));
          bb.suggestions = bb.suggestions.filter((x) => !x.stop_id || !gone.has(x.stop_id));
        }
        const ids: string[] = [];
        const base = { version: 1, created_at: stamp(), updated_at: stamp() };
        r.stops.forEach((x, i) => {
          const id = (x.id as string) || crypto.randomUUID();
          ids.push(id);
          bb.stops.push({ tz: null, altitude_m: null, color: null, notes: null, code: null, meta: null, tip: null, area: null, photo: null, ...base, id, trip_id: bb.trip.id, position: i, name: String(x.name).slice(0, 80), country: (x.country as string) || null, lat: (x.lat as number) ?? null, lng: (x.lng as number) ?? null, arrival_date: x.arrival_date as string, departure_date: x.departure_date as string, arrival_mode: (x.arrival_mode as never) ?? null, stay_base: x.stay_base && typeof x.stay_base === 'object' ? x.stay_base as never : null } as unknown as TripBundle['stops'][number]);
        });
        for (const l of r.legs ?? []) {
          bb.transports.push({ origin_code: null, dest_code: null, depart_time: null, depart_tz: null, arrive_date: null, arrive_time: null, arrive_tz: null, booking_ref: null, seat: null, notes: null, document_id: null, ...base, id: crypto.randomUUID(), trip_id: bb.trip.id, stop_id: ids[l.stop_index as number], mode: (l.mode as never) ?? 'other', origin_name: (l.origin_name as string) ?? null, dest_name: (l.dest_name as string) ?? null, depart_date: (l.depart_date as string) ?? null, duration_min: (l.duration_min as number) ?? null, price_cents: (l.price_cents as number) ?? null, price_currency: l.price_cents == null ? null : bb.trip.base_currency, price_is_estimate: true, is_return: !!l.is_return } as unknown as TripBundle['transports'][number]);
        }
        for (const sg of r.suggestions ?? []) {
          bb.suggestions.push({ ...DEFAULTS.suggestions, ...base, id: crypto.randomUUID(), trip_id: bb.trip.id, stop_id: ids[sg.stop_index as number], kind: 'activity', day: (sg.day as number) ?? null, payload: sg.payload as never, status: (sg.status as never) ?? 'new', source: 'ai' } as unknown as TripBundle['suggestions'][number]);
        }
        if (r.budget_plan) bb.trip.budget_plan = r.budget_plan as never;
        if (r.onboarding) bb.trip.onboarding = r.onboarding as never;
        bb.trip.version++;
        stores.set(key, bb); emit('stops'); return undefined as never;
      }
      if (fn === 'save_expense') {
        const e = args.p_expense as Record<string, unknown>;
        const shares = args.p_shares as { user_id: string; share_cents: number }[];
        const bb = b();
        // Mesmas regras de save_expense (…0008_redesign.sql): no máximo um item, e da mesma viagem.
        const links = (['activity_id', 'stay_id', 'transport_id'] as const).filter((k) => e[k]);
        if (links.length > 1) throw fail('Um gasto paga no máximo um item do roteiro', '22023');
        const exists = (k: (typeof links)[number]) =>
          (k === 'activity_id' ? bb.activities : k === 'stay_id' ? bb.stays : bb.transports).some((x) => x.id === e[k]);
        if (links.length && !exists(links[0])) throw fail('O item ligado ao gasto não é desta viagem', '22023');
        for (const k of ['activity_id', 'stay_id', 'transport_id'] as const) e[k] = e[k] || null;
        let eid = e.id as string | undefined;
        if (eid) {
          const row = bb.expenses.find((x) => x.id === eid);
          if (!row || row.version !== e.version) throw new ConflictError('Este gasto foi alterado ou removido por outra pessoa');
          Object.assign(row, e, { version: row.version + 1 });
          bb.expenseShares = bb.expenseShares.filter((s) => s.expense_id !== eid);
        } else {
          eid = crypto.randomUUID();
          bb.expenses.unshift({ ...(e as unknown as import('./types').Expense), id: eid, trip_id: bb.trip.id, version: 1, created_at: stamp(), updated_at: stamp(), created_by: DEMO_USER });
        }
        for (const s of shares) bb.expenseShares.push({ expense_id: eid, trip_id: bb.trip.id, ...s });
        const stay = bb.stays.find((s) => s.id === e.stay_id && s.status === 'pending');
        if (stay) { stay.status = 'booked'; stay.version++; }
        emit('expenses');
        return eid as never;
      }
      if (fn === 'promote_inspiration') {
        // Mesmas regras de supabase/migrations/…0007_votes.sql
        const bb = b();
        const entry = bb.journalEntries.find((e) => e.id === args.p_entry);
        if (!entry) throw fail('Inspiração não encontrada', 'P0002');
        const role = bb.members.find((m) => m.user_id === DEMO_USER)?.role;
        if (role !== 'organizer' && role !== 'editor') throw fail('Só organizador e editores levam inspirações para o roteiro', '42501');
        if (entry.kind !== 'inspiracao') throw fail('Só inspirações vão para o roteiro', '22023');
        if (bb.activities.some((a) => a.from_entry_id === entry.id)) throw fail('Esta inspiração já está no roteiro', '23505');
        const stop = bb.stops.find((s) => s.id === args.p_stop);
        if (!stop) throw fail('Parada não encontrada nesta viagem', '22023');
        const day = args.p_day as string | null;
        if (!day || day < stop.arrival_date || day > stop.departure_date) throw fail(`Escolha um dia entre a chegada e a saída de ${stop.name}`, '22023');
        const sameDay = bb.activities.filter((a) => a.stop_id === stop.id && a.day === day);
        const notes = [entry.body?.trim() || null, entry.link_url].filter(Boolean).join('\n\n');
        const aid = crypto.randomUUID();
        bb.activities.push({
          id: aid, trip_id: bb.trip.id, stop_id: stop.id, day, time: (args.p_time as string | null) ?? null,
          title: (entry.title?.trim() || entry.place_name?.trim() || 'Inspiração').slice(0, 160), notes: notes ? notes.slice(0, 2000) : null,
          position: sameDay.length ? Math.max(...sameDay.map((a) => a.position)) + 1 : 0, suggested_by: null, from_entry_id: entry.id, from_poll_id: null,
          version: 1, created_at: stamp(), updated_at: stamp(),
        });
        if (!entry.stop_id && entry.author_id === DEMO_USER) Object.assign(entry, { stop_id: stop.id, version: entry.version + 1, updated_at: stamp() });
        emit('activities');
        return aid as never;
      }
      if (fn === 'cast_vote') {
        const bb = b();
        const poll = bb.polls.find((p) => p.id === args.p_poll);
        if (!poll || !bb.members.some((m) => m.user_id === DEMO_USER)) throw fail('Você não participa desta viagem', '42501');
        if (poll.status !== 'open' || (poll.closes_at && Date.parse(poll.closes_at) <= Date.now())) throw fail('Votação encerrada', 'P0001');
        const chosen = [...new Set((args.p_options as string[] | null) ?? [])];
        const own = bb.pollOptions.filter((o) => o.poll_id === poll.id);
        if (chosen.some((id) => !own.some((o) => o.id === id))) throw fail('Opção não pertence a esta enquete', '22023');
        if (!poll.multi && chosen.length > 1) throw fail('Nesta votação cada pessoa marca uma opção', '22023');
        if (chosen.length > own.length) throw fail('Opções demais para esta enquete', '22023');
        bb.pollVotes = bb.pollVotes.filter((v) => !(v.poll_id === poll.id && v.user_id === DEMO_USER));
        for (const option_id of chosen) bb.pollVotes.push({ poll_id: poll.id, option_id, trip_id: bb.trip.id, user_id: DEMO_USER, created_at: stamp() });
        emit('poll_votes');
        return null as never;
      }
      if (fn === 'close_poll') {
        const bb = b();
        const poll = bb.polls.find((p) => p.id === args.p_poll);
        const me = bb.members.find((m) => m.user_id === DEMO_USER);
        if (!poll || !me || (me.role !== 'organizer' && poll.created_by !== DEMO_USER)) throw fail('Só quem criou a enquete ou o organizador decide', '42501');
        if (poll.status !== 'open') throw fail('Enquete já encerrada', 'P0001');
        const opt = bb.pollOptions.find((o) => o.id === args.p_option && o.poll_id === poll.id);
        if (!opt) throw fail('Opção não pertence a esta enquete', '22023');
        const stop = poll.target !== 'free' && poll.stop_id ? bb.stops.find((s) => s.id === poll.stop_id) ?? null : null;
        const apply = args.p_apply !== false;
        const day = (args.p_day as string | null | undefined) || stop?.arrival_date;
        if (apply && poll.target === 'activity' && stop && day && (day < stop.arrival_date || day > stop.departure_date)) {
          throw fail(`Escolha um dia entre a chegada e a saída de ${stop.name}`, '22023');
        }
        Object.assign(poll, { status: 'closed', decided_option_id: opt.id, decided_by: DEMO_USER, decided_at: stamp(), version: poll.version + 1, updated_at: stamp() });
        emit('polls');
        if (!apply) return { applied: false, reason: 'not_applied' } as never;
        if (poll.target === 'free') return { applied: false, reason: 'free' } as never;
        if (!stop || !day) return { applied: false, reason: 'no_stop' } as never;
        const notes = [opt.detail?.trim() || null, opt.link_url].filter(Boolean).join('\n\n').slice(0, 2000) || null;
        if (poll.target === 'stay') {
          if (bb.stays.some((s) => s.stop_id === stop.id && s.status === 'booked')) return { applied: false, reason: 'stay_booked', stay_id: null } as never;
          const pending = bb.stays.find((s) => s.stop_id === stop.id && s.status === 'pending');
          if (pending) {
            Object.assign(pending, { name: opt.label.slice(0, 120), address: opt.address, notes, from_poll_id: poll.id, version: pending.version + 1, updated_at: stamp() });
            emit('stays');
            return { applied: true, reason: null, stay_id: pending.id } as never;
          }
          const sid = crypto.randomUUID();
          bb.stays.push({
            id: sid, trip_id: bb.trip.id, stop_id: stop.id, name: opt.label.slice(0, 120), address: opt.address, checkin_date: stop.arrival_date, checkin_time: null,
            checkout_date: stop.departure_date, checkout_time: null, status: 'pending', notes, document_id: null, suggested_by: null, from_poll_id: poll.id,
            version: 1, created_at: stamp(), updated_at: stamp(),
          });
          emit('stays');
          return { applied: true, reason: null, stay_id: sid } as never;
        }
        const sameDay = bb.activities.filter((a) => a.stop_id === stop.id && a.day === day);
        const aid = crypto.randomUUID();
        bb.activities.push({
          id: aid, trip_id: bb.trip.id, stop_id: stop.id, day, time: null, title: opt.label.slice(0, 160), notes,
          position: sameDay.length ? Math.max(...sameDay.map((a) => a.position)) + 1 : 0, suggested_by: null, from_entry_id: null, from_poll_id: poll.id,
          version: 1, created_at: stamp(), updated_at: stamp(),
        });
        emit('activities');
        return { applied: true, reason: null, activity_id: aid } as never;
      }
      if (fn === 'create_invite') throw new Error('Convites não funcionam na demonstração. Crie uma trilha real para convidar a turma.');
      throw new Error(`Indisponível na demonstração: ${fn}`);
    },
    async upload() {
      throw new Error('Na demonstração os arquivos não são enviados. Crie uma trilha real para guardar documentos.');
    },
    async removeFiles() {},
    async download() {
      throw new Error('Documento de exemplo: não há arquivo real na demonstração.');
    },
    async signedUrl() {
      throw new Error('Documento de exemplo: não há arquivo real na demonstração.');
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
