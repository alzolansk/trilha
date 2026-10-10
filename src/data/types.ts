import type { DestinationIdentity } from '../lib/identity/types';

// Tipos das linhas do banco (espelham supabase/migrations).

export type Role = 'organizer' | 'editor' | 'viewer';
export type TransportMode = 'plane' | 'bus' | 'train' | 'car' | 'walk' | 'boat' | 'other';
export type StayStatus = 'pending' | 'booked';
export type DocCategory = 'passagem' | 'identidade' | 'reserva' | 'ingresso' | 'seguro' | 'outro';
export type DocVisibility = 'private' | 'shared' | 'trip';
export type TaskStatus = 'todo' | 'doing' | 'done';
export type JournalPhase = 'antes' | 'durante' | 'depois';
export type TripStyle = 'Mochilão' | 'Conforto' | 'Aventura' | 'Cultural';
export type Provenance = 'ai' | 'rules';
export type TaskLink = 'documentos' | 'mala' | 'roteiro' | 'turma';

/** Dica contextual (SPEC AiTip) com a origem real do conteúdo. */
export interface AiTip {
  text: string;
  kind: 'clima' | 'altitude' | 'fronteira' | 'reserva' | 'logistica' | 'cultura' | 'outro';
  source?: string;
  by: Provenance;
  model?: string;
  generated_at: string;
}

interface Versioned {
  id: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface Profile extends Omit<Versioned, 'id'> {
  id: string;
  display_name: string;
  color: string;
  analytics_opt_in?: boolean;
}

export interface Trip extends Versioned {
  title: string;
  tagline: string | null;
  destinations: string[];
  start_date: string;
  end_date: string;
  departure_at: string | null;
  departure_tz: string;
  home_tz: string;
  base_currency: string;
  budget_total: string | number | null;
  cover_path: string | null;
  created_by: string | null;
  origin: string | null;
  style: TripStyle;
  return_at: string | null;
  identity: DestinationIdentity | null;
  identity_version: number;
}

export interface Member {
  trip_id: string;
  user_id: string;
  role: Role;
  joined_at: string;
}

export interface Invite {
  id: string;
  trip_id: string;
  role: Role;
  created_by: string;
  expires_at: string;
  max_uses: number;
  uses: number;
  revoked_at: string | null;
  created_at: string;
}

export interface Stop extends Versioned {
  trip_id: string;
  position: number;
  name: string;
  country: string | null;
  arrival_date: string;
  departure_date: string;
  tz: string | null;
  altitude_m: number | null;
  lat: number | null;
  lng: number | null;
  arrival_mode: TransportMode | null;
  color: string | null;
  notes: string | null;
  code: string | null;
  meta: string | null;
  tip: AiTip | null;
}

export interface Transport extends Versioned {
  trip_id: string;
  stop_id: string;
  mode: TransportMode;
  origin_code: string | null;
  origin_name: string | null;
  dest_code: string | null;
  dest_name: string | null;
  depart_date: string | null;
  depart_time: string | null;
  depart_tz: string | null;
  arrive_date: string | null;
  arrive_time: string | null;
  arrive_tz: string | null;
  booking_ref: string | null;
  seat: string | null;
  notes: string | null;
  duration_min: number | null;
  document_id: string | null;
}

export interface Stay extends Versioned {
  trip_id: string;
  stop_id: string;
  name: string;
  address: string | null;
  checkin_date: string | null;
  checkin_time: string | null;
  checkout_date: string | null;
  checkout_time: string | null;
  status: StayStatus;
  notes: string | null;
  document_id: string | null;
  suggested_by: Provenance | null;
  /** enquete cuja decisão criou/atualizou esta hospedagem */
  from_poll_id: string | null;
}

export interface Activity extends Versioned {
  trip_id: string;
  stop_id: string;
  day: string;
  time: string | null;
  title: string;
  notes: string | null;
  position: number;
  suggested_by: Provenance | null;
  /** inspiração do Diário que virou esta atividade */
  from_entry_id: string | null;
  /** enquete cuja decisão criou esta atividade */
  from_poll_id: string | null;
}

export interface DocumentRow extends Versioned {
  trip_id: string;
  owner_id: string;
  title: string;
  category: DocCategory;
  visibility: DocVisibility;
  stop_id: string | null;
  storage_path: string;
  preview_path: string | null;
  original_name: string;
  mime: string;
  size_bytes: number;
  valid_from: string | null;
  valid_until: string | null;
  notes: string | null;
  status: 'uploading' | 'ready';
  subtitle: string | null;
  classified_by: 'user' | 'ai' | 'rules' | null;
  ai_confidence: number | null;
  is_shot: boolean;
  /** arquivo e prévia cifrados no navegador (AES-256-GCM); falso só em documentos antigos */
  encrypted: boolean;
}

/** Chave AES do documento embrulhada para uma pessoa (ver lib/crypto/e2e). */
export interface DocumentKey {
  document_id: string;
  user_id: string;
  wrapped_key: string;
}

export interface UserPublicKey {
  user_id: string;
  public_key: JsonWebKey;
}

export interface OfflinePref {
  user_id: string;
  document_id: string;
  keep_offline: boolean;
}

export interface DocumentShare {
  document_id: string;
  user_id: string;
}

export interface PackingCategory extends Versioned {
  trip_id: string;
  name: string;
  position: number;
}

export interface PackingItem extends Versioned {
  trip_id: string;
  category_id: string;
  label: string;
  done: boolean;
  done_by: string | null;
  suggestion_reason: string | null;
  position: number;
  suggested_by: Provenance | null;
}

export interface Task extends Versioned {
  trip_id: string;
  title: string;
  assignee_id: string | null;
  due_date: string | null;
  status: TaskStatus;
  created_by: string | null;
  detail: string | null;
  link: TaskLink;
  source: 'user' | Provenance;
  alert_key: string | null;
  dismissed: boolean;
}

export interface BudgetCategory extends Versioned {
  trip_id: string;
  name: string;
  color: string;
  planned: string | number;
  position: number;
}

export interface Expense extends Versioned {
  trip_id: string;
  description: string;
  category_id: string | null;
  stop_id: string | null;
  payer_id: string;
  amount: string | number;
  currency: string;
  rate_to_base: string | number;
  rate_source: string;
  rate_date: string;
  rate_is_manual: boolean;
  base_amount: string | number;
  spent_on: string;
  /** pago com dinheiro do caixa da turma */
  paid_from_pool: boolean;
  created_by: string | null;
}

/** Aporte no caixa da turma (deposit) ou devolução do caixa para a pessoa (refund). */
export interface PoolContribution {
  id: string;
  trip_id: string;
  user_id: string;
  kind: 'deposit' | 'refund';
  amount_cents: number;
  contributed_on: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface ExpenseShare {
  expense_id: string;
  trip_id: string;
  user_id: string;
  share_cents: number;
}

export interface Settlement {
  id: string;
  trip_id: string;
  from_user: string;
  to_user: string;
  amount_cents: number;
  paid_on: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface JournalEntry extends Versioned {
  trip_id: string;
  stop_id: string | null;
  author_id: string;
  phase: JournalPhase;
  entry_date: string | null;
  title: string | null;
  body: string | null;
  link_url: string | null;
  favorite: boolean;
  kind: 'inspiracao' | 'registro';
  place_name: string | null;
}

/** Reação a uma inspiração: 2 = quero muito · 1 = topo · -1 = passo */
export type InspirationValue = -1 | 1 | 2;
export interface InspirationVote { entry_id: string; trip_id: string; user_id: string; value: InspirationValue; updated_at: string }
export type PollTarget = 'stay' | 'activity' | 'free';
export interface Poll extends Versioned {
  trip_id: string; question: string; detail: string | null; target: PollTarget; stop_id: string | null;
  multi: boolean; closes_at: string | null; status: 'open' | 'closed';
  decided_option_id: string | null; decided_by: string | null; decided_at: string | null; created_by: string;
}
export interface PollOption {
  id: string; poll_id: string; trip_id: string; label: string; detail: string | null; link_url: string | null;
  price: string | number | null; currency: string | null; address: string | null; position: number;
  created_by: string; created_at: string;
}
export interface PollVote { poll_id: string; option_id: string; trip_id: string; user_id: string; created_at: string }

export interface TripRetro {
  trip_id: string;
  content: RetroContent;
  generated_by: Provenance;
  created_at: string;
  updated_at: string;
}

export interface RetroContent {
  title: string;
  intro: string;
  chapters: { stop_id: string | null; heading: string; text: string }[];
  closing: string;
  model?: string;
}

export interface JournalPhoto {
  id: string;
  trip_id: string;
  entry_id: string;
  storage_path: string;
  width: number | null;
  height: number | null;
  size_bytes: number;
  caption: string | null;
  position: number;
  created_by: string;
  created_at: string;
}

/** Tudo de uma viagem, carregado de uma vez e guardado no IndexedDB para uso offline. */
export interface TripBundle {
  trip: Trip;
  members: Member[];
  profiles: Profile[];
  stops: Stop[];
  transports: Transport[];
  stays: Stay[];
  activities: Activity[];
  documents: DocumentRow[];
  documentShares: DocumentShare[];
  /** chaves embrulhadas visíveis para mim (as minhas e quem mais já tem, nos documentos que leio) */
  documentKeys: DocumentKey[];
  /** chaves públicas da turma (só de quem já criou o cofre) */
  publicKeys: UserPublicKey[];
  packingCategories: PackingCategory[];
  packingItems: PackingItem[];
  tasks: Task[];
  budgetCategories: BudgetCategory[];
  expenses: Expense[];
  expenseShares: ExpenseShare[];
  settlements: Settlement[];
  poolContributions: PoolContribution[];
  journalEntries: JournalEntry[];
  journalPhotos: JournalPhoto[];
  inspirationVotes: InspirationVote[];
  polls: Poll[];
  pollOptions: PollOption[];
  pollVotes: PollVote[];
  offlinePrefs: OfflinePref[];
  retro: TripRetro | null;
  /** quando este pacote foi obtido do servidor (ISO) */
  fetchedAt: string;
}

export type TableName =
  | 'trips' | 'trip_members' | 'trip_invites' | 'profiles' | 'stops' | 'transports' | 'stays'
  | 'activities' | 'documents' | 'document_shares' | 'packing_categories' | 'packing_items'
  | 'tasks' | 'budget_categories' | 'expenses' | 'expense_shares' | 'settlements'
  | 'journal_entries' | 'journal_photos' | 'document_offline_prefs' | 'trip_retros'
  | 'notification_prefs' | 'push_subscriptions' | 'analytics_events' | 'document_keys' | 'user_keys' | 'pool_contributions'
  | 'inspiration_votes' | 'polls' | 'poll_options' | 'poll_votes';

export const BUNDLE_KEYS: Partial<Record<TableName, keyof TripBundle>> = {
  trip_members: 'members',
  stops: 'stops',
  transports: 'transports',
  stays: 'stays',
  activities: 'activities',
  documents: 'documents',
  document_shares: 'documentShares',
  document_keys: 'documentKeys',
  user_keys: 'publicKeys',
  packing_categories: 'packingCategories',
  packing_items: 'packingItems',
  tasks: 'tasks',
  budget_categories: 'budgetCategories',
  expenses: 'expenses',
  expense_shares: 'expenseShares',
  settlements: 'settlements',
  pool_contributions: 'poolContributions',
  journal_entries: 'journalEntries',
  journal_photos: 'journalPhotos',
  inspiration_votes: 'inspirationVotes',
  polls: 'polls',
  poll_options: 'pollOptions',
  poll_votes: 'pollVotes',
  document_offline_prefs: 'offlinePrefs',
};

export interface TripSummary {
  trip: Trip;
  role: Role;
  stopCount: number;
}
