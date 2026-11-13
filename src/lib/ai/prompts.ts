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

/**
 * Passeios no mapa (ajuste de 09/11): onde cada atividade do roteiro acontece e, quando é um percurso,
 * o trajeto em ordem. Coordenadas nulas = não é um lugar ("tarde livre"). O servidor confere a distância.
 */
const coordOrNull = (max: number) => z.number().min(-max).max(max).nullable().optional();
export const locateSchema = z.object({
  items: z.array(z.object({
    i: z.number().int().min(0).max(99),
    name: z.string().max(80).nullable().optional(),
    lat: coordOrNull(90),
    lng: coordOrNull(180),
    path: z.array(z.object({ name: z.string().max(80).nullable().optional(), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })).max(12).nullable().optional(),
  })).max(40),
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
// Janela do lugar: schema TOLERANTE (ajuste de 09/11/2026). O estrito (tamanhos máximos, inteiros, listas com teto)
// recusava quase toda resposta: um texto 5 caracteres maior ou um custo 12.5 derrubava a janela inteira e a pessoa
// via "Não deu pra carregar os detalhes agora". Aqui só se exige o essencial (nome, resumo, por que vale); o resto
// é aceito como vier e `normalizeDetail` corta no tamanho, tira itens ruins e limita as listas.
const looseNum = z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? Number(v.replace(',', '.')) : v), z.number().finite());
const optNum = looseNum.nullish().catch(null);
const optStr = z.preprocess((v) => (typeof v === 'number' ? String(v) : v), z.string().nullish()).catch(null);
const reqStr = z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1));
/** Lista que aceita string solta (vira lista de um) e descarta só os itens inválidos, sem derrubar o resto. */
function looseList<T extends z.ZodType>(item: T) {
  return z.preprocess((v) => (v == null ? [] : Array.isArray(v) ? v : [v]), z.array(z.unknown()))
    .catch([])
    .transform((xs) => xs.flatMap((x) => { const r = item.safeParse(x); return r.success ? [r.data as z.output<T>] : []; }));
}
export const placeDetailSchema = z.preprocess(
  // Alguns modelos embrulham a resposta: {"detail": {...}} ou {"place": {...}}.
  (v) => (v && typeof v === 'object' && !Array.isArray(v) && !('summary' in v) && Object.keys(v).length === 1 ? Object.values(v)[0] : v),
  z.object({
    name: reqStr,
    type: optStr,
    parent: optStr,
    country: optStr.transform((x) => x ?? ''),
    region: optStr,
    lat: optNum,
    lng: optNum,
    summary: reqStr,
    why_go: looseList(reqStr),
    fit: looseList(z.object({ trait: reqStr, text: reqStr })),
    for_whom: optStr,
    caveats: looseList(reqStr),
    time: z.object({
      label: optStr.transform((x) => x ?? ''),
      options: looseList(z.object({ label: reqStr, text: reqStr, suggested: z.boolean().nullish().catch(null) })),
      why: optStr.transform((x) => x ?? ''),
      stay_base: z.boolean().nullish().catch(null),
    }).catch({ label: '', options: [], why: '', stay_base: null }),
    best_moment: optStr,
    getting_around: optStr,
    highlights: looseList(z.object({
      name: reqStr,
      scope: optStr,
      what: reqStr,
      why: optStr,
      duration: optStr,
      cost: optStr,
      booking: optStr,
      lat: optNum,
      lng: optNum,
    })),
    visit: looseList(z.object({
      when: reqStr, text: reqStr,
      refs: looseList(looseNum.transform((n) => Math.round(n))),
    })),
    practical: z.object({
      getting_there: optStr,
      best_time: optStr,
      costs: looseList(z.object({ item: reqStr, low: looseNum, high: looseNum, unit: optStr.transform((x) => x ?? '') })),
      cost_note: optStr,
      limits: looseList(reqStr),
      check_at: optStr,
    }).catch({ getting_there: null, best_time: null, costs: [], cost_note: null, limits: [], check_at: null }),
  }),
);

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
