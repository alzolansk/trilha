import 'server-only';
import { z } from 'zod';

export const BASE_RULES = `Você é a IA do app de viagens Trilha. Regras obrigatórias:
- Português do Brasil, informal e direto, segunda pessoa ("pra", "dá pra"). Uma ou duas frases.
- Você só SUGERE. Nunca diga que executou algo ("baixei", "reservei", "anexei", "deixei", "coloquei"): você não fez nada disso.
- Você não navega na internet e não verifica nada em tempo real: nunca diga "verificado", "confirmado" ou "atualizado em".
- Fatos sensíveis (vistos, vacinas, regras de fronteira, saúde, documentos exigidos): só mencione indicando em "source" o site oficial (domínio do governo ou do órgão responsável) onde a pessoa deve conferir. Sem um site oficial conhecido, NÃO afirme: sugira conferir com o consulado ou órgão oficial.
- Não invente previsão do tempo, preços, horários, distâncias, altitudes ou reservas. Use só os dados fornecidos ou conhecimento geral estável.
- Responda APENAS com JSON válido no formato pedido.`;

export const tipSchema = z.object({
  text: z.string().min(10).max(280),
  kind: z.enum(['clima', 'altitude', 'fronteira', 'reserva', 'logistica', 'cultura', 'outro']),
  source: z.string().max(200).nullable().optional(),
  verified_at: z.string().max(20).nullable().optional(),
});

export const packingSchema = z.object({
  items: z.array(z.object({
    label: z.string().min(2).max(80),
    group: z.enum(['Documentos', 'Roupas', 'Equipamento', 'Farmácia', 'Outros']),
    reason: z.string().min(8).max(200),
  })).max(12),
});

export const classifySchema = z.object({
  category: z.enum(['passagem', 'identidade', 'reserva', 'ingresso', 'seguro', 'outro']),
  stop_id: z.string().max(40).nullable(),
  title: z.string().min(2).max(120),
  subtitle: z.string().max(120).nullable(),
  confidence: z.number().min(0).max(1),
  valid_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

export const alertsSchema = z.object({
  alerts: z.array(z.object({
    key: z.string().regex(/^[a-z0-9-]{3,60}$/),
    title: z.string().min(5).max(140),
    detail: z.string().max(280),
    link: z.enum(['documentos', 'mala', 'roteiro', 'turma']),
    source: z.string().max(200).nullable().optional(),
  })).max(6),
});

export const retroSchema = z.object({
  title: z.string().min(3).max(120),
  intro: z.string().min(5).max(400),
  chapters: z.array(z.object({ stop_id: z.string().max(40).nullable(), heading: z.string().max(80), text: z.string().max(400) })).max(20),
  closing: z.string().max(300),
});

/** Bloqueia frases de "ação executada" que a IA não pode ter feito. */
export function claimsAction(text: string): boolean {
  return /\b(baixei|reservei|anexei|deixei|coloquei|comprei|agendei|marquei|salvei|enviei|verifiquei|confirmei|chequei|consultei)\b/i.test(text);
}

/** Dica sobre fato sensível sem fonte é descartada (SPEC §9.1). */
export function sensitiveWithoutSource(t: { text: string; kind: string; source?: string | null }): boolean {
  const sensitive = t.kind === 'fronteira' || /\b(visto|vacina|febre amarela|passaporte|fronteira|imigra|exig)/i.test(t.text);
  return sensitive && !t.source;
}

/**
 * Exceção controlada à regra "não invente preços/distâncias": no planejamento a pessoa pede
 * ordem de grandeza. Só faixas aproximadas, que o app mostra com o selo ESTIMATIVA.
 */
export const EXPLORE_RULES = `${BASE_RULES}
- EXCEÇÃO para esta tarefa: você PODE dar faixas APROXIMADAS de preço e de tempo de viagem, baseadas em conhecimento geral (ordem de grandeza, não valor exato). O app mostra tudo como ESTIMATIVA e manda conferir antes de reservar.
- Nunca cite nome de hotel, pousada, empresa ou estabelecimento específico: fale de bairros, regiões, tipos de passeio e atrações públicas conhecidas.
- Valores sempre em números inteiros na moeda pedida, sem símbolo.`;

const money = z.number().int().min(0).max(10_000_000);

export const exploreDestSchema = z.object({
  origin: z.object({ name: z.string().max(80), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).nullable().optional(),
  items: z.array(z.object({
    name: z.string().min(2).max(80),
    region: z.string().max(80),
    country: z.string().max(60),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    why: z.string().min(8).max(220),
    mode: z.enum(['bus', 'car', 'plane', 'train', 'boat']),
    hours: z.number().min(0.2).max(40),
    cost_low: money,
    cost_high: money,
    /** paradas sugeridas do roteiro (2–6 nomes), usadas por "Montar esta trilha" */
    stops: z.array(z.string().min(2).max(60)).max(6).default([]),
    /** busca de foto (nome do lugar + palavra-chave) */
    photo_query: z.string().max(80).nullable().optional(),
    /** vibes que o lugar atende (natureza, cidade, praia, cultura, aventura, comida) */
    tags: z.array(z.string().max(20)).max(6).default([]),
  })).min(1).max(6),
});

export const exploreActivitySchema = z.object({
  items: z.array(z.object({
    title: z.string().min(3).max(80),
    why: z.string().min(8).max(200),
    duration: z.string().max(30),
    cost_low: money,
    cost_high: money,
    // Fase 10 (opcionais: respostas antigas continuam válidas)
    tags: z.array(z.string().max(20)).max(6).optional(),
    day_fit: z.enum(['manha', 'tarde', 'noite', 'dia_todo']).nullable().optional(),
    photo_query: z.string().max(80).nullable().optional(),
    wish: z.string().max(80).nullable().optional(),
  })).min(1).max(8),
});

// ───────────── Onboarding roteirizado (planning §10.13) ─────────────
const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);
const mode = z.enum(['plane', 'bus', 'train', 'car', 'boat']);
const placeType = z.enum(['cidade', 'regiao', 'bairro', 'atracao', 'experiencia']);

export const explorePlacesSchema = z.object({
  items: z.array(z.object({
    name: z.string().min(2).max(80),
    region: z.string().max(80).nullable().optional(),
    country: z.string().min(2).max(60),
    lat, lng,
    why: z.string().min(8).max(220),
    nights_min: z.number().int().min(1).max(30),
    nights_max: z.number().int().min(1).max(30),
    highlights: z.array(z.string().min(2).max(80)).max(3).default([]),
    photo_query: z.string().max(80).nullable().optional(),
    tags: z.array(z.string().max(20)).max(6).default([]),
    attractions: z.array(z.object({ name: z.string().min(2).max(80), why: z.string().max(200).nullable().optional() })).max(6).default([]),
    tip: z.string().max(220).nullable().optional(),
    // Recomendações pessoais (opcionais: respostas antigas continuam válidas)
    type: placeType.nullable().optional(),
    parent: z.string().max(80).nullable().optional(),
    fit: z.string().max(220).nullable().optional(),
  })).min(3).max(12),
  nearby: z.array(z.object({
    name: z.string().min(2).max(80),
    country: z.string().min(2).max(60),
    lat, lng,
    why: z.string().min(8).max(220),
    from: z.string().min(2).max(80),
    mode,
    hours: z.number().min(0.2).max(12),
    kind: z.enum(['bate_volta', 'parada']),
    cost_low: money,
    cost_high: money,
    photo_query: z.string().max(80).nullable().optional(),
    attractions: z.array(z.object({ name: z.string().min(2).max(80), why: z.string().max(200).nullable().optional() })).max(4).default([]),
    tip: z.string().max(220).nullable().optional(),
  })).max(10).default([]),
});

const legSchema = z.object({ from: z.string().min(2).max(80), to: z.string().min(2).max(80), mode, hours: z.number().min(0.1).max(40), cost_low: money, cost_high: money });
const pair = z.tuple([money, money]);
export const exploreRouteSchema = z.object({
  outbound: z.object({ to: z.string().min(2).max(80), mode, hours: z.number().min(0.1).max(48), cost_low: money, cost_high: money }).nullable().optional(),
  /** bilhete de IDA E VOLTA por pessoa (origem → destino → origem), dividido pelo app entre ida e volta */
  flights: z.object({ cost_low: money, cost_high: money }).nullable().optional(),
  stops: z.array(z.object({
    name: z.string().min(2).max(80),
    country: z.string().min(2).max(60),
    lat, lng,
    nights: z.number().int().min(1).max(60),
    why: z.string().max(220).nullable().optional(),
    day_trips: z.array(z.object({
      name: z.string().min(2).max(80), day_offset: z.number().int().min(0).max(60), cost_low: money, cost_high: money,
      why: z.string().max(220).nullable().optional(), lat: lat.nullable().optional(), lng: lng.nullable().optional(), wish: z.string().max(80).nullable().optional(),
    })).max(4).default([]),
    wish: z.string().max(80).nullable().optional(),
    stay_pp_night: z.object({ economico: pair.optional(), equilibrado: pair.optional(), conforto: pair.optional() }).partial().optional(),
    /** cidade vizinha mais barata onde os turistas costumam dormir (ex.: Costa Amalfitana → Salerno) */
    stay_alt: z.object({
      name: z.string().min(2).max(80),
      country: z.string().max(60).nullable().optional(),
      lat: lat.nullable().optional(), lng: lng.nullable().optional(),
      why: z.string().max(220).nullable().optional(),
      mode,
      minutes: z.number().min(1).max(240),
      commute_pp_day: money,
      stay_pp_night: z.object({ economico: pair.optional(), equilibrado: pair.optional(), conforto: pair.optional() }).partial(),
    }).nullable().optional(),
  })).min(1).max(12),
  legs: z.array(legSchema).max(12).default([]),
  return: z.object({ from: z.string().min(2).max(80), mode, hours: z.number().min(0.1).max(48), cost_low: money, cost_high: money }).nullable().optional(),
  food_pp_day: z.array(z.object({ country: z.string().min(2).max(60), low: money, high: money })).max(6).default([]),
  left_out: z.array(z.object({
    name: z.string().min(2).max(80), reason: z.string().min(2).max(160),
    sacrifice: z.string().max(200).nullable().optional(), lat: lat.nullable().optional(), lng: lng.nullable().optional(),
  })).max(12).default([]),
  wishes: z.array(z.object({
    wish: z.string().max(80), stop: z.string().max(80).nullable(),
    how: z.string().max(220).nullable().optional(), reason: z.string().max(200).nullable().optional(), sacrifice: z.string().max(200).nullable().optional(),
  })).max(5).default([]),
});

/** Resumo de lugares pedidos sob demanda: adicionados à mão, paradas sugeridas, bate-voltas e "ficou de fora". */
export const placeInfoSchema = z.object({
  items: z.array(z.object({
    asked: z.string().min(1).max(80),
    name: z.string().min(2).max(80),
    kind: z.enum(['lugar', 'experiencia']).default('lugar'),
    base: z.string().max(80).nullable().optional(),
    region: z.string().max(80).nullable().optional(),
    country: z.string().min(2).max(60),
    lat, lng,
    why: z.string().min(8).max(260),
    nights_min: z.number().int().min(0).max(30).default(1),
    nights_max: z.number().int().min(0).max(30).default(2),
    highlights: z.array(z.string().min(2).max(80)).max(3).default([]),
    photo_query: z.string().max(80).nullable().optional(),
    tags: z.array(z.string().max(20)).max(6).default([]),
    attractions: z.array(z.object({ name: z.string().min(2).max(80), why: z.string().max(200).nullable().optional() })).max(6).default([]),
    tip: z.string().max(220).nullable().optional(),
    type: placeType.nullable().optional(),
    parent: z.string().max(80).nullable().optional(),
  })).min(1).max(8),
});

/** Perfil da viagem a partir do texto livre do passo 2. */
export const profileSchema = z.object({
  summary: z.string().min(10).max(320),
  traits: z.array(z.object({
    label: z.string().min(2).max(40),
    detail: z.string().max(160).nullable().optional(),
    evidence: z.string().max(120).nullable().optional(),
  })).max(6).default([]),
  avoid: z.array(z.string().min(2).max(80)).max(4).default([]),
  group: z.string().max(40).nullable().optional(),
  vibes: z.array(z.string().max(20)).max(6).default([]),
  pace: z.enum(['leve', 'moderado', 'intenso']).nullable().optional(),
  stay: z.enum(['economico', 'equilibrado', 'conforto']).nullable().optional(),
});

/** Conteúdo da janela de um lugar (normalizado depois por lib/placeDetail.ts normalizeDetail). */
export const placeDetailSchema = z.object({
  name: z.string().min(2).max(80),
  type: placeType,
  parent: z.string().max(80).nullable().optional(),
  country: z.string().min(2).max(60),
  region: z.string().max(80).nullable().optional(),
  lat: lat.nullable().optional(),
  lng: lng.nullable().optional(),
  summary: z.string().min(8).max(260),
  why_go: z.array(z.string().min(20).max(600)).min(1).max(2),
  fit: z.array(z.object({ trait: z.string().max(40), text: z.string().min(8).max(240) })).max(4).default([]),
  for_whom: z.string().max(240).nullable().optional(),
  caveats: z.array(z.string().min(6).max(200)).max(3).default([]),
  time: z.object({
    label: z.string().min(2).max(40),
    options: z.array(z.object({ label: z.string().min(1).max(40), text: z.string().min(4).max(160), suggested: z.boolean().nullable().optional() })).max(3).default([]),
    why: z.string().max(320),
    stay_base: z.boolean().nullable().optional(),
  }),
  best_moment: z.string().max(60).nullable().optional(),
  getting_around: z.string().max(60).nullable().optional(),
  highlights: z.array(z.object({
    name: z.string().min(2).max(80),
    scope: z.enum(['especifico', 'amplo']).nullable().optional(),
    what: z.string().min(6).max(220),
    why: z.string().max(200).nullable().optional(),
    duration: z.string().max(40).nullable().optional(),
    cost: z.enum(['gratis', 'pago', 'varia']).nullable().optional(),
    booking: z.string().max(80).nullable().optional(),
    lat: lat.nullable().optional(),
    lng: lng.nullable().optional(),
  })).max(5).default([]),
  visit: z.array(z.object({ when: z.string().min(2).max(30), text: z.string().min(4).max(180), refs: z.array(z.number().int()).max(5).default([]) })).max(5).default([]),
  practical: z.object({
    getting_there: z.string().max(320).nullable().optional(),
    best_time: z.string().max(320).nullable().optional(),
    costs: z.array(z.object({ item: z.string().min(2).max(60), low: money, high: money, unit: z.string().max(30) })).max(6).default([]),
    cost_note: z.string().max(160).nullable().optional(),
    limits: z.array(z.string().min(4).max(160)).max(4).default([]),
    check_at: z.string().max(120).nullable().optional(),
  }).default({ costs: [], limits: [] }),
});

export const exploreStaySchema = z.object({
  areas: z.array(z.object({
    name: z.string().min(2).max(60),
    why: z.string().min(8).max(200),
    price_low: money,
    price_high: money,
  })).min(1).max(4),
});

// Trilha 2.0 (planning §8.2): sugestões persistidas. Mesmos campos do explore + encaixe no dia,
// esforço e o termo de busca da foto (nome do lugar como está na Wikipedia).
export const suggestActivitySchema = z.object({
  items: z.array(z.object({
    title: z.string().min(3).max(80),
    why: z.string().min(8).max(200),
    duration: z.string().max(30),
    day_fit: z.enum(['manha', 'tarde', 'noite', 'dia_todo']),
    effort: z.enum(['leve', 'moderado', 'puxado']),
    cost_low: money,
    cost_high: money,
    photo_query: z.string().min(2).max(80),
  })).min(1).max(6),
  areas: z.array(z.object({
    name: z.string().min(2).max(60),
    why: z.string().min(8).max(200),
    price_low: money,
    price_high: money,
    photo_query: z.string().min(2).max(80),
    good: z.string().max(80).optional(),
    watch: z.string().max(80).optional(),
  })).max(3).optional(),
});

// Estimativas do Orçamento (planning §8.3): sempre faixa, nunca valor exato.
export const estimateTransportSchema = z.object({
  items: z.array(z.object({
    id: z.string().min(1).max(40),
    mode: z.enum(['plane', 'bus', 'train', 'car', 'boat', 'other']),
    cost_low: money,
    cost_high: money,
  })).max(30),
});
export const estimateDailySchema = z.object({ cost_low: money, cost_high: money });
