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
  })).min(1).max(6),
});

export const exploreActivitySchema = z.object({
  items: z.array(z.object({
    title: z.string().min(3).max(80),
    why: z.string().min(8).max(200),
    duration: z.string().max(30),
    cost_low: money,
    cost_high: money,
  })).min(1).max(8),
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
