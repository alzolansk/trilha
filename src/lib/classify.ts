// Reconhecimento assistido de documentos: regras verificáveis sobre o texto extraído
// (PDF ou OCR). O resultado é sempre uma SUGESTÃO para a pessoa confirmar.
import type { DocCategory, Stop, Transport } from '../data/types';
import { normalize } from './format';

const KEYWORDS: Record<Exclude<DocCategory, 'outro'>, string[]> = {
  passagem: [
    'boarding pass', 'cartao de embarque', 'tarjeta de embarque', 'pase de abordar', 'e-ticket', 'eticket',
    'voo', 'vuelo', 'flight', 'localizador', 'pnr', 'assento', 'asiento', 'seat', 'portao', 'gate',
    'passagem', 'pasaje', 'bilhete', 'boleto de viaje', 'onibus', 'bus', 'tren', 'train', 'trem', 'embarque',
  ],
  reserva: [
    'reserva', 'reservation', 'booking', 'check-in', 'check in', 'checkout', 'check-out', 'hostel', 'hotel',
    'hospedagem', 'hospedaje', 'pousada', 'airbnb', 'acomodacao', 'alojamiento', 'noites', 'nights', 'huesped', 'hospede',
  ],
  ingresso: ['ingresso', 'entrada', 'ticket de entrada', 'admission', 'admit one', 'tour', 'excursao', 'excursion', 'visitante', 'qr code'],
  seguro: ['seguro', 'apolice', 'poliza', 'insurance', 'policy', 'cobertura', 'coverage', 'assistencia', 'asistencia', 'segurado', 'vigencia'],
  identidade: [
    'passaporte', 'passport', 'pasaporte', 'registro geral', 'carteira de identidade', 'documento de identidade',
    'cpf', 'nacionalidade', 'nationality', 'data de nascimento', 'date of birth', 'vacina', 'vaccination', 'febre amarela', 'yellow fever',
  ],
};

export interface Suggestion {
  category: DocCategory | null;
  categoryReason: string | null;
  stopId: string | null;
  stopReason: string | null;
  title: string | null;
  snippet: string;
}

function countHits(text: string, words: string[]): string[] {
  return words.filter((w) => {
    const re = new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`);
    return re.test(text);
  });
}

export function suggestFromText(raw: string, fileName: string, stops: Stop[], transports: Transport[]): Suggestion {
  const text = normalize(`${raw}\n${fileName.replace(/[_.-]+/g, ' ')}`);
  const snippet = raw.replace(/\s+/g, ' ').trim().slice(0, 220);

  // Categoria: maior número de palavras-chave distintas; exige vantagem clara.
  const scores = (Object.keys(KEYWORDS) as (keyof typeof KEYWORDS)[])
    .map((cat) => ({ cat, hits: countHits(text, KEYWORDS[cat]) }))
    .sort((a, b) => b.hits.length - a.hits.length);
  let category: DocCategory | null = null;
  let categoryReason: string | null = null;
  const [first, second] = scores;
  if (first.hits.length >= 2 && first.hits.length > (second?.hits.length ?? 0)) {
    category = first.cat;
    categoryReason = `Encontrei: ${first.hits.slice(0, 4).map((h) => `“${h}”`).join(', ')}`;
  } else if (first.hits.length === 1 && (second?.hits.length ?? 0) === 0) {
    category = first.cat;
    categoryReason = `Encontrei “${first.hits[0]}” (sinal fraco, confira)`;
  }

  // Parada: nome da parada ou código do trecho que chega nela aparece no texto.
  const stopHits = stops
    .map((s) => {
      const reasons: string[] = [];
      const name = normalize(s.name);
      if (name.length >= 3 && text.includes(name)) reasons.push(`nome “${s.name}”`);
      for (const t of transports.filter((t) => t.stop_id === s.id)) {
        if (t.dest_code && t.dest_code.length >= 3 && new RegExp(`\\b${t.dest_code}\\b`).test(raw)) {
          reasons.push(`código ${t.dest_code}`);
        }
        if (t.booking_ref && t.booking_ref.length >= 5 && raw.toUpperCase().includes(t.booking_ref.toUpperCase())) {
          reasons.push(`localizador ${t.booking_ref}`);
        }
      }
      return { s, reasons };
    })
    .filter((x) => x.reasons.length > 0)
    .sort((a, b) => b.reasons.length - a.reasons.length);
  let stopId: string | null = null;
  let stopReason: string | null = null;
  if (stopHits.length && (stopHits.length === 1 || stopHits[0].reasons.length > stopHits[1].reasons.length)) {
    stopId = stopHits[0].s.id;
    stopReason = `Aparece ${stopHits[0].reasons.join(' e ')}`;
  }

  // Título: só propõe rota "AAA → BBB" se os dois códigos estiverem explícitos no texto.
  let title: string | null = null;
  const route = raw.match(/\b([A-Z]{3})\s*(?:-|–|→|>|\/|to|para|a)\s*([A-Z]{3})\b/);
  if (route && route[1] !== route[2] && category === 'passagem') title = `${route[1]} → ${route[2]}`;

  return { category, categoryReason, stopId, stopReason, title, snippet };
}

export function guessTitleFromFileName(name: string): string {
  const base = name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1, 120) : 'Documento';
}
