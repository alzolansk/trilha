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
  // Campos da migration 20261108000008 (Trilha 2.0). Opcionais: cópias offline antigas e
  // projetos com a migration pendente não os têm.
  /** cor de destaque (#RRGGBB); null = automática (ver lib/identity/accent.ts) */
  accent?: string | null;
  /** respostas do Orçamento em conversa (lib/budgetPlan.ts) */
  budget_plan?: BudgetPlan | null;
  // Migration 20261108000010 (Fase 10).
  /** pessoas na viagem, contando quem ainda não está no app (null = usa os membros) */
  party_size?: number | null;
  /** rascunho do onboarding roteirizado (lib/onboarding.ts) */
  onboarding?: OnboardingState | null;
}

/** Marcação do passo 3 do onboarding. */
export type PlaceMark = 'must' | 'maybe' | 'skip';
/**
 * O que o lugar é (muda o cabeçalho, a unidade de tempo e as noites): cidade e região pedem noites;
 * bairro e atração ficam dentro de uma cidade (`parent`) e se medem em horas; experiência sai de uma base.
 */
export type PlaceType = 'cidade' | 'regiao' | 'bairro' | 'atracao' | 'experiencia';
/** Lugar sugerido no passo 3 (valores em centavos da moeda base). */
export interface PlaceIdea {
  name: string;
  region?: string | null;
  country: string;
  lat?: number | null;
  lng?: number | null;
  why: string;
  nights_min: number;
  nights_max: number;
  highlights?: string[];
  photo_query?: string | null;
  tags?: string[];
  /** principais pontos turísticos / experiências, com uma frase (janela de detalhes) */
  attractions?: PlaceAttraction[];
  /** dica prática curta (melhor horário, como circular) */
  tip?: string | null;
  /** adicionado à mão pela pessoa */
  added?: boolean;
  /** veio do Descobrir */
  from_discover?: boolean;
  /** 'experiencia' = não é cidade (trem panorâmico, trilha, parque): acontece a partir de `base` */
  kind?: 'lugar' | 'experiencia';
  /** cidade de onde a experiência sai (ex.: Bernina Express → Tirano) */
  base?: string | null;
  /** a IA já completou resumo, foto e passeios (lugar adicionado à mão ou vindo do Descobrir) */
  enriched?: boolean;
  /** tipo do lugar (respostas antigas não têm: tratadas como cidade) */
  type?: PlaceType | null;
  /** cidade onde fica o bairro ou a atração */
  parent?: string | null;
  /** uma frase ligando o lugar ao perfil da turma (só com base no que ela contou) */
  fit?: string | null;
}
/** Resumo de um lugar buscado sob demanda (parada sugerida, bate-volta, "ficou de fora"). Cache em onboarding.info. */
export interface PlaceInfo {
  name: string;
  country: string;
  region?: string | null;
  lat?: number | null;
  lng?: number | null;
  why: string;
  kind?: 'lugar' | 'experiencia';
  base?: string | null;
  nights_min?: number;
  nights_max?: number;
  highlights?: string[];
  photo_query?: string | null;
  tags?: string[];
  attractions?: PlaceAttraction[];
  tip?: string | null;
  type?: PlaceType | null;
  parent?: string | null;
}
export interface PlaceAttraction {
  name: string;
  why?: string | null;
}
/** "Perto daqui": cidade próxima de um dos lugares (inclusive em país vizinho). */
export interface NearbyIdea {
  name: string;
  country: string;
  lat?: number | null;
  lng?: number | null;
  why: string;
  /** de onde se chega */
  from: string;
  mode: TransportMode;
  hours: number;
  kind: 'bate_volta' | 'parada';
  /** custo extra por pessoa (ida e volta), centavos */
  cost_low: number;
  cost_high: number;
  photo_query?: string | null;
  attractions?: PlaceAttraction[];
  tip?: string | null;
}
export interface RouteLeg {
  from: string;
  to: string;
  mode: TransportMode;
  hours: number | null;
  /** por pessoa, centavos; null = a recalcular */
  cost_low: number | null;
  cost_high: number | null;
}
export interface RouteDayTrip {
  name: string;
  /** dia dentro da parada (0 = dia da chegada) */
  day_offset: number;
  cost_low: number;
  cost_high: number;
  /** uma frase do que é o lugar */
  why?: string | null;
  lat?: number | null;
  lng?: number | null;
  /** desejo do passo 3 que este bate-volta atende */
  wish?: string | null;
}
export interface RouteStop {
  name: string;
  country: string;
  lat?: number | null;
  lng?: number | null;
  nights: number;
  why?: string | null;
  day_trips: RouteDayTrip[];
  /** desejo do passo 3 que fez a parada entrar (ex.: cidade de onde sai o Bernina Express) */
  wish?: string | null;
  /** cidade vizinha mais barata para dormir, sugerida pela IA só quando a economia é considerável */
  stay_alt?: StayBase | null;
  /** a pessoa escolheu dormir na `stay_alt` */
  stay_at_alt?: boolean;
  /** diária por pessoa, por estilo (centavos) */
  stay_pp_night?: Partial<Record<BudgetStyle, { low: number; high: number }>>;
}
/** Lugar pedido que não entrou: o motivo e o que dá pra sacrificar para caber. */
export interface RouteLeftOut {
  name: string;
  reason: string;
  /** o que tirar para caber (ex.: "1 noite a menos em Roma") */
  sacrifice?: string | null;
  lat?: number | null;
  lng?: number | null;
}
/** Onde cada desejo do passo 3 entrou. `stop` null = não coube. */
export interface RouteWish {
  wish: string;
  stop: string | null;
  /** como fazer (de onde sai, quanto tempo leva) */
  how?: string | null;
  /** por que não coube */
  reason?: string | null;
  /** o que tirar para caber */
  sacrifice?: string | null;
}
export interface RouteProposal {
  outbound: RouteLeg | null;
  stops: RouteStop[];
  /** legs[i] liga stops[i] a stops[i + 1] */
  legs: RouteLeg[];
  return: RouteLeg | null;
  food_pp_day: { country: string; low: number; high: number }[];
  left_out: RouteLeftOut[];
  wishes: RouteWish[];
  generated_at: string;
}
/** Passeio sugerido no passo 5 (centavos da moeda base). */
export interface TourIdea {
  id: string;
  title: string;
  why?: string | null;
  duration?: string | null;
  cost_low: number;
  cost_high: number;
  tags?: string[];
  day_fit?: DayFit | null;
  photo_query?: string | null;
  /** desejo do passo 3 que este passeio atende */
  wish?: string | null;
}
export interface OnboardingPrefs {
  vibes: string[];
  pace: BudgetPace;
  stay: BudgetStyle;
  /** teto por pessoa, em unidades da moeda base */
  budget?: number | null;
  /** sugerir cidade vizinha mais barata para dormir (padrão: sim) */
  stay_nearby?: boolean;
  /** como a turma imagina a viagem, nas palavras dela (passo 2) */
  story?: string | null;
}
/** Um traço do perfil, com o trecho do texto da pessoa que o justifica. */
export interface TravelTrait {
  label: string;
  detail?: string | null;
  /** trecho do que a pessoa escreveu (nunca inventado) */
  evidence?: string | null;
}
/** O que a Trilha entendeu do texto livre do passo 2 (planning: recomendações pessoais). */
export interface TravelProfile {
  /** duas frases na voz da Trilha: "Vocês querem…" */
  summary: string;
  traits: TravelTrait[];
  /** o que querem evitar */
  avoid: string[];
  /** quem vai (casal, amigos, família, sozinho), se disseram */
  group?: string | null;
  /** gostos (ids de VIBES) inferidos do texto */
  vibes: string[];
  pace?: BudgetPace | null;
  stay?: BudgetStyle | null;
  generated_at: string;
}

export type CostKind = 'gratis' | 'pago' | 'varia';
/** Destaque da janela do lugar: atração específica ou sugestão ampla ("explorar os cafés do bairro"). */
export interface PlaceHighlight {
  name: string;
  scope: 'especifico' | 'amplo';
  /** o que fazer ali */
  what: string;
  /** por que vale */
  why?: string | null;
  duration?: string | null;
  cost?: CostKind | null;
  /** precisa reservar? (texto curto, ex.: "ingresso antecipado") */
  booking?: string | null;
  lat?: number | null;
  lng?: number | null;
}
export interface PlaceVisitStep {
  /** momento ilustrativo ("Fim de tarde", "Manhã") */
  when: string;
  text: string;
  /** destaques citados (posição 1-based em `highlights`) */
  refs: number[];
}
/** Linha de custo estimado: centavos por `unit`; low = high = 0 é grátis. */
export interface PlaceCostLine {
  item: string;
  low: number;
  high: number;
  unit: string;
}
/** Conteúdo completo da janela do lugar, pedido sob demanda e guardado em onboarding.details. */
export interface PlaceDetail {
  name: string;
  type: PlaceType;
  parent?: string | null;
  country: string;
  region?: string | null;
  lat?: number | null;
  lng?: number | null;
  /** o que é o lugar, em uma frase neutra */
  summary: string;
  /** por que vale conhecer: atmosfera, identidade, contexto (1 a 2 parágrafos) */
  why_go: string[];
  /** por que combina com vocês: cada motivo ligado a um traço ou gosto que a turma informou */
  fit: { trait: string; text: string }[];
  /** para quem é, quando a turma não contou preferências */
  for_whom?: string | null;
  /** pode não valer a pena se… */
  caveats: string[];
  time: {
    label: string;
    options: { label: string; text: string; suggested?: boolean }[];
    why: string;
    /** bairro: serve de base para se hospedar? */
    stay_base?: boolean | null;
  };
  best_moment?: string | null;
  getting_around?: string | null;
  highlights: PlaceHighlight[];
  visit: PlaceVisitStep[];
  practical: {
    getting_there?: string | null;
    best_time?: string | null;
    costs: PlaceCostLine[];
    cost_note?: string | null;
    limits: string[];
    /** site oficial onde conferir horários e agenda (domínio), quando a IA conhece */
    check_at?: string | null;
  };
  currency: string;
  generated_at: string;
}

export type OnboardingStep = 2 | 3 | 4 | 5 | 6;
export interface OnboardingState {
  status: 'em_andamento' | 'concluido' | 'manual' | 'pulado';
  step: OnboardingStep;
  flexible_dates?: boolean;
  prefs?: OnboardingPrefs | null;
  places?: { items: PlaceIdea[]; nearby: NearbyIdea[]; fetched_at: string } | null;
  /** chave = nome normalizado (placeKey) */
  marks?: Record<string, PlaceMark>;
  wishes?: string[];
  route?: RouteProposal | null;
  route_calls?: number;
  /** passeios sugeridos por parada (id da parada) */
  tours?: Record<string, TourIdea[]>;
  /** ids de TourIdea recomendados pela Trilha (ritmo e gostos) */
  tour_pick?: string[];
  /** decisão carta a carta no passo 5 */
  tour_decisions?: Record<string, 'yes' | 'no'>;
  stale?: ('places' | 'route' | 'tours')[];
  /** cidades do destino escolhido no Descobrir (entram no passo 3) */
  discover_stops?: string[];
  /** passeios do passo 5 já gravados no roteiro (evita gravar duas vezes) */
  tours_applied?: boolean;
  /** resumos buscados sob demanda (chave = placeKey do nome) */
  info?: Record<string, PlaceInfo>;
  /** perfil entendido do texto livre (passo 2) */
  profile?: TravelProfile | null;
  /** conteúdo da janela de cada lugar (chave = placeKey do nome) */
  details?: Record<string, PlaceDetail>;
}

/** Foto escolhida: Wikimedia (com crédito) ou upload próprio (`path` no bucket covers). */
export interface PhotoRef {
  url?: string;
  path?: string;
  width?: number;
  height?: number;
  author?: string | null;
  license?: string | null;
  source_url?: string | null;
}

export type BudgetStyle = 'economico' | 'equilibrado' | 'conforto';
export type BudgetPace = 'leve' | 'moderado' | 'intenso';
export type BudgetFood = 'econ' | 'medio' | 'solto';
/** Respostas do Orçamento em conversa, gravadas em trips.budget_plan. */
/** Como a turma dorme: dividindo o quarto (diária dividida) ou cada um no seu quarto. */
export type RoomShare = 'shared' | 'private';
export interface BudgetPlan {
  style: BudgetStyle;
  pace: BudgetPace;
  /** quarto dividido (padrão) ou um quarto por pessoa; muda só a hospedagem estimada */
  room?: RoomShare | null;
  /** ids de atividades/sugestões que entram na conta de passeios */
  activities?: string[];
  /** diária de comida por pessoa, em centavos (estimativa confirmada pela turma) */
  daily_food_cents?: number | null;
  /** ritmo de comida escolhido (Econômico / Médio / Solto) */
  food?: BudgetFood | null;
  /** valor por pessoa de trechos sem preço no roteiro (estimativa da Trilha), por id do transporte.
   *  As chaves 'ida' e 'volta' guardam o voo virtual quando o roteiro ainda não tem esse trecho. */
  transport_cents?: Record<string, number> | null;
  /** faixa da diária de comida por pessoa (centavos), ponderada pelas noites em cada país */
  food_range?: { low: number; high: number } | null;
  /** faixas dos trechos (centavos por pessoa), por id do transporte ou 'ida'/'volta' */
  transport_ranges?: Record<string, { low: number; high: number }> | null;
  /** Faixa da diária por pessoa, por parada e estilo; mediana das regiões sugeridas. */
  stay_estimates?: Record<string, Partial<Record<BudgetStyle, { low: number; high: number }>>>;
  /** foto do roteiro usada no cálculo, para avisar o que mudou depois (diffSince) */
  snapshot?: BudgetSnapshot | null;
  updated_at?: string;
}
export interface BudgetSnapshot {
  stops: { id: string; nights: number }[];
  people: number;
  at: string;
  /** total por pessoa de cada categoria no fechamento (centavos), para o aviso com valores */
  lines?: Partial<Record<'transporte' | 'hospedagem' | 'passeios' | 'comida', number>>;
}

export interface Member {
  trip_id: string;
  user_id: string;
  role: Role;
  joined_at: string;
  /** cota individual no caixa, em centavos (null = planejado ÷ pessoas) */
  pool_target_cents?: number | null;
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
  /** bairro escolhido para ficar */
  area?: string | null;
  photo?: PhotoRef | null;
  // Migration 20261108000011.
  /** dormir numa cidade vizinha mais barata (null = dorme na própria cidade) */
  stay_base?: StayBase | null;
}

/** Cidade vizinha mais barata para dormir, de onde se vai e volta todo dia (valores em centavos, por pessoa). */
export interface StayBase {
  name: string;
  country?: string | null;
  lat?: number | null;
  lng?: number | null;
  /** por que muita gente dorme lá */
  why?: string | null;
  mode: TransportMode;
  /** minutos de cada ida */
  minutes: number;
  /** ida e volta por pessoa, por dia */
  commute_pp_day: number;
  /** diária por pessoa na base, por estilo */
  stay_pp_night?: Partial<Record<BudgetStyle, { low: number; high: number }>>;
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
  /** por pessoa */
  price_cents?: number | null;
  price_currency?: string | null;
  price_is_estimate?: boolean;
  /** trecho de volta para casa, ligado à última parada (migration 00010) */
  is_return?: boolean;
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
  /** por noite, quarto/casa inteiro */
  price_cents?: number | null;
  price_currency?: string | null;
  price_is_estimate?: boolean;
  link_url?: string | null;
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
  /** por pessoa */
  cost_cents?: number | null;
  cost_currency?: string | null;
  cost_is_estimate?: boolean;
  photo?: PhotoRef | null;
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
  /** quem leva */
  assignee_id?: string | null;
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
  /** tipo fixo da categoria (antes casava pelo nome); ausente em cópias antigas */
  kind?: BudgetKind;
}
export type BudgetKind = 'transporte' | 'hospedagem' | 'passeios' | 'comida' | 'outro';

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
  /** item do roteiro que este gasto paga (no máximo um) */
  activity_id?: string | null;
  stay_id?: string | null;
  transport_id?: string | null;
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

export type SuggestionKind = 'destination' | 'activity' | 'area' | 'reminder';
export type SuggestionStatus = 'new' | 'accepted' | 'voting' | 'dismissed';
export type DayFit = 'manha' | 'tarde' | 'noite' | 'dia_todo';
export interface SuggestionPayload {
  title: string;
  why?: string | null;
  duration?: string | null;
  day_fit?: DayFit | null;
  effort?: 'leve' | 'moderado' | 'puxado' | null;
  /** faixa estimada por pessoa, em centavos da moeda `currency` */
  cost_low?: number | null;
  cost_high?: number | null;
  currency?: string | null;
  photo_query?: string | null;
  photo?: PhotoRef | null;
  /** bairros: o que é bom, o que pede atenção e a distância a pé do centro (só quando a fonte disser) */
  good?: string | null;
  watch?: string | null;
  walk?: string | null;
  /** lembretes: para onde o cartão leva e de qual regra veio */
  href?: string | null;
  rule?: string | null;
  label?: string | null;
}
export interface Suggestion extends Versioned {
  trip_id: string;
  stop_id: string | null;
  kind: SuggestionKind;
  /** dia da viagem (1 = primeiro dia) */
  day: number | null;
  payload: SuggestionPayload;
  status: SuggestionStatus;
  source: Provenance;
  acted_by: string | null;
  acted_at: string | null;
}
export interface TripPreference {
  trip_id: string;
  user_id: string;
  answers: Record<string, unknown>;
  updated_at: string;
}

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
  suggestions: Suggestion[];
  tripPreferences: TripPreference[];
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
  | 'inspiration_votes' | 'polls' | 'poll_options' | 'poll_votes' | 'suggestions' | 'trip_preferences';

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
  suggestions: 'suggestions',
  trip_preferences: 'tripPreferences',
  document_offline_prefs: 'offlinePrefs',
};

export interface TripSummary {
  trip: Trip;
  role: Role;
  stopCount: number;
}
