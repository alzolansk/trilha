import type { TableName, TripBundle } from './types';

export class ConflictError extends Error {
  constructor(message = 'Alguém alterou este item enquanto você editava.') {
    super(message);
    this.name = 'ConflictError';
  }
}
export class OfflineError extends Error {
  constructor(message = 'Sem conexão. Essa ação precisa de internet; nada foi salvo.') {
    super(message);
    this.name = 'OfflineError';
  }
}

export type Bucket = 'documents' | 'journal' | 'covers';

/** Acesso aos dados de uma viagem. Implementado pelo Supabase (real) e pela demonstração (memória). */
export interface TripSource {
  kind: 'supabase' | 'demo';
  tripId: string;
  userId: string;
  load(): Promise<TripBundle>;
  insert<T = Record<string, unknown>>(table: TableName, row: Record<string, unknown>, opts?: { returning?: boolean }): Promise<T>;
  /** Atualiza com controle de versão quando `version` é informado (lança ConflictError). */
  update<T = Record<string, unknown>>(table: TableName, id: string, patch: Record<string, unknown>, version?: number): Promise<T>;
  updateWhere(table: TableName, match: Record<string, unknown>, patch: Record<string, unknown>): Promise<void>;
  upsert(table: TableName, row: Record<string, unknown>, onConflict: string): Promise<void>;
  remove(table: TableName, match: Record<string, unknown>): Promise<void>;
  rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T>;
  upload(bucket: Bucket, path: string, file: Blob, contentType: string): Promise<void>;
  removeFiles(bucket: Bucket, paths: string[]): Promise<void>;
  download(bucket: Bucket, path: string): Promise<Blob>;
  signedUrl(bucket: Bucket, path: string, seconds?: number): Promise<string>;
  subscribe(onChange: (table: string) => void): () => void;
}

/** Mensagem humana em pt-BR para erros do Supabase/rede. */
export function humanError(e: unknown): string {
  if (e instanceof ConflictError || e instanceof OfflineError) return e.message;
  const err = e as { message?: string; code?: string; status?: number };
  const msg = err?.message ?? String(e);
  if (typeof navigator !== 'undefined' && !navigator.onLine) return new OfflineError().message;
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return 'Não deu pra falar com o servidor. Confira a conexão e tente de novo.';
  if (err?.code === '42501' || /row-level security|permission denied/i.test(msg)) return 'Você não tem permissão para isso nesta viagem.';
  if (err?.code === '23514' || err?.code === '22023' || err?.code === 'P0001' || err?.code === 'P0002') return msg;
  if (err?.code === '23505') return 'Isso já existe.';
  if (/JWT|session|not authenticated|Não autenticado/i.test(msg)) return 'Sua sessão expirou. Entre de novo.';
  if (/Payload too large|exceeded the maximum allowed size/i.test(msg)) return 'Arquivo grande demais.';
  return msg || 'Algo deu errado. Tente de novo.';
}
