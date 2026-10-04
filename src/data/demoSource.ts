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
      const full = { id: crypto.randomUUID(), trip_id: b().trip.id, version: 1, created_at: stamp(), updated_at: stamp(), ...row };
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
