'use client';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ConflictError, OfflineError, type Bucket, type TripSource } from './source';
import type { TableName, TripBundle } from './types';

const CHILD_TABLES: { table: TableName; key: keyof TripBundle; order?: [string, boolean][] }[] = [
  { table: 'trip_members', key: 'members' },
  { table: 'stops', key: 'stops', order: [['position', true], ['arrival_date', true]] },
  { table: 'transports', key: 'transports' },
  { table: 'stays', key: 'stays' },
  { table: 'activities', key: 'activities', order: [['day', true], ['position', true]] },
  { table: 'documents', key: 'documents', order: [['created_at', false]] },
  { table: 'packing_categories', key: 'packingCategories', order: [['position', true]] },
  { table: 'packing_items', key: 'packingItems', order: [['position', true], ['created_at', true]] },
  { table: 'tasks', key: 'tasks', order: [['created_at', true]] },
  { table: 'budget_categories', key: 'budgetCategories', order: [['position', true]] },
  { table: 'expenses', key: 'expenses', order: [['spent_on', false], ['created_at', false]] },
  { table: 'expense_shares', key: 'expenseShares' },
  { table: 'settlements', key: 'settlements', order: [['paid_on', false]] },
  { table: 'journal_entries', key: 'journalEntries', order: [['entry_date', true], ['created_at', true]] },
  { table: 'journal_photos', key: 'journalPhotos', order: [['position', true]] },
];

const REALTIME_TABLES = [
  'trip_members', 'stops', 'transports', 'stays', 'activities', 'documents',
  'packing_categories', 'packing_items', 'tasks', 'budget_categories', 'expenses', 'expense_shares',
  'settlements', 'journal_entries', 'journal_photos', 'trip_retros',
];

function ensureOnline() {
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new OfflineError();
}

export function createSupabaseSource(sb: SupabaseClient, tripId: string, userId: string): TripSource {
  return {
    kind: 'supabase',
    tripId,
    userId,

    async load() {
      const tripRes = await sb.from('trips').select('*').eq('id', tripId).maybeSingle();
      if (tripRes.error) throw tripRes.error;
      if (!tripRes.data) throw Object.assign(new Error('Viagem não encontrada ou sem acesso.'), { code: 'NOT_FOUND' });
      const results = await Promise.all(
        CHILD_TABLES.map(async ({ table, order }) => {
          let q = sb.from(table).select('*').eq('trip_id', tripId);
          for (const [col, asc] of order ?? []) q = q.order(col, { ascending: asc, nullsFirst: false });
          const r = await q;
          if (r.error) throw r.error;
          return r.data;
        }),
      );
      const bundle = { trip: tripRes.data } as TripBundle;
      CHILD_TABLES.forEach(({ key }, i) => ((bundle as unknown as Record<string, unknown>)[key] = results[i]));
      const docIds = bundle.documents.map((d) => d.id);
      const [shares, prefs, retro, profiles] = await Promise.all([
        docIds.length ? sb.from('document_shares').select('*').in('document_id', docIds) : Promise.resolve({ data: [], error: null }),
        docIds.length ? sb.from('document_offline_prefs').select('*').eq('user_id', userId).in('document_id', docIds) : Promise.resolve({ data: [], error: null }),
        sb.from('trip_retros').select('*').eq('trip_id', tripId).maybeSingle(),
        sb.from('profiles').select('*').in('id', bundle.members.map((m) => m.user_id)),
      ]);
      for (const r of [shares, prefs, retro, profiles]) if (r.error) throw r.error;
      bundle.documentShares = shares.data ?? [];
      bundle.offlinePrefs = prefs.data ?? [];
      bundle.retro = retro.data ?? null;
      bundle.profiles = profiles.data ?? [];
      bundle.fetchedAt = new Date().toISOString();
      return bundle;
    },

    async insert(table, row, opts) {
      ensureOnline();
      if (opts?.returning === false) {
        const r = await sb.from(table).insert(row);
        if (r.error) throw r.error;
        return row as never;
      }
      const r = await sb.from(table).insert(row).select().single();
      if (r.error) throw r.error;
      return r.data;
    },

    async update(table, id, patch, version) {
      ensureOnline();
      let q = sb.from(table).update(patch).eq('id', id);
      if (version != null) q = q.eq('version', version);
      const r = await q.select();
      if (r.error) throw r.error;
      if (!r.data || r.data.length === 0) {
        if (version != null) throw new ConflictError();
        throw Object.assign(new Error('Item não encontrado ou sem permissão.'), { code: '42501' });
      }
      return r.data[0];
    },

    async updateWhere(table, match, patch) {
      ensureOnline();
      let q = sb.from(table).update(patch);
      for (const [k, v] of Object.entries(match)) q = q.eq(k, v as string);
      const r = await q;
      if (r.error) throw r.error;
    },

    async upsert(table, row, onConflict) {
      ensureOnline();
      const r = await sb.from(table).upsert(row, { onConflict });
      if (r.error) throw r.error;
    },

    async remove(table, match) {
      ensureOnline();
      let q = sb.from(table).delete();
      for (const [k, v] of Object.entries(match)) q = q.eq(k, v as string);
      const r = await q;
      if (r.error) throw r.error;
    },

    async rpc(fn, args) {
      ensureOnline();
      const r = await sb.rpc(fn, args);
      if (r.error) throw r.error;
      return r.data;
    },

    async upload(bucket: Bucket, path, file, contentType) {
      ensureOnline();
      const r = await sb.storage.from(bucket).upload(path, file, { contentType, upsert: false, cacheControl: '3600' });
      if (r.error) throw r.error;
    },

    async removeFiles(bucket, paths) {
      ensureOnline();
      if (!paths.length) return;
      const r = await sb.storage.from(bucket).remove(paths);
      if (r.error) throw r.error;
    },

    async download(bucket, path) {
      ensureOnline();
      const r = await sb.storage.from(bucket).download(path);
      if (r.error) throw r.error;
      return r.data;
    },

    async signedUrl(bucket, path, seconds = 300) {
      ensureOnline();
      const r = await sb.storage.from(bucket).createSignedUrl(path, seconds);
      if (r.error) throw r.error;
      return r.data.signedUrl;
    },

    subscribe(onChange) {
      const ch = sb.channel(`trip:${tripId}:${Math.random().toString(36).slice(2)}`);
      for (const table of REALTIME_TABLES) {
        ch.on('postgres_changes', { event: '*', schema: 'public', table, filter: `trip_id=eq.${tripId}` }, () => onChange(table));
      }
      ch.on('postgres_changes', { event: '*', schema: 'public', table: 'trips', filter: `id=eq.${tripId}` }, () => onChange('trips'));
      // sem coluna trip_id: o RLS só entrega eventos de documentos visíveis para a pessoa
      ch.on('postgres_changes', { event: '*', schema: 'public', table: 'document_shares' }, () => onChange('document_shares'));
      ch.subscribe();
      return () => {
        void sb.removeChannel(ch);
      };
    },
  };
}
