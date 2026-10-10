'use client';
// Fonte de dados da demonstração: tudo em memória, some ao recarregar. Serve para
// explorar as 4 identidades e para QA, sem tocar em dados reais.
import { buildDemoBundle, DEMO_USER, type DemoKey } from '../lib/demo/build';
import { ConflictError, type TripSource } from './source';
import { BUNDLE_KEYS, type TableName, type TripBundle } from './types';

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
};

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
      const list = listFor(b(), table);
      if (list) {
        for (let i = list.length - 1; i >= 0; i--) if (matches(list[i], m)) list.splice(i, 1);
      }
      emit(table);
    },
    async rpc(fn, args) {
      if (fn === 'save_expense') {
        const e = args.p_expense as Record<string, unknown>;
        const shares = args.p_shares as { user_id: string; share_cents: number }[];
        const bb = b();
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
