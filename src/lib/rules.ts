// Regras verificáveis sobre os dados da trilha. Alimentam alertas (AUTO), dicas e
// sugestões quando a IA não está configurada ou como base para ela. Nada aqui afirma
// fatos externos (clima, vistos, regras de fronteira): só o que dá para conferir nos dados.
import type { PackingItem, Stop, TripBundle } from '../data/types';
import { arrivalOf, durationLabel, sortedStops, stayOf, transportMinutes } from './derive';
import { dayMonth, normalize } from './format';
import { budgetByCategory, toCents } from './money';
import { addDays, daysBetween, todayIn, tzDiffHours } from './time';

export interface RuleAlert {
  key: string;
  title: string;
  detail: string;
  link: 'documentos' | 'mala' | 'roteiro' | 'turma';
  cta: string;
  severity: 1 | 2 | 3; // 3 = mais importante
}

export function ruleAlerts(b: TripBundle, now = Date.now()): RuleAlert[] {
  const out: RuleAlert[] = [];
  const stops = sortedStops(b);
  const trip = b.trip;
  const today = todayIn(trip.departure_tz || 'America/Sao_Paulo', now);

  // Seguro que termina antes da volta (pela data de validade informada no documento).
  const insurance = b.documents.filter((d) => d.category === 'seguro' && d.status === 'ready' && d.valid_until);
  if (insurance.length) {
    const until = insurance.map((d) => d.valid_until as string).sort().at(-1) as string;
    if (until < trip.end_date) {
      out.push({
        key: 'insurance-gap',
        title: `Seguro cobre até ${dayMonth(until)}, sua volta é ${dayMonth(trip.end_date)}`,
        detail: `Faltam ${daysBetween(until, trip.end_date)} dia(s) de cobertura pelo que está no documento.`,
        link: 'documentos', cta: 'Resolver', severity: 3,
      });
    }
  }

  // Documento de identidade com validade antes da volta.
  for (const d of b.documents.filter((x) => x.category === 'identidade' && x.valid_until && x.status === 'ready')) {
    if ((d.valid_until as string) < trip.end_date) {
      out.push({ key: `id-expired-${d.id}`, title: `${d.title} vence em ${dayMonth(d.valid_until)}`, detail: 'A validade informada termina antes da volta.', link: 'documentos', cta: 'Ver documento', severity: 3 });
    } else if (/passaport|passport/i.test(d.title) && (d.valid_until as string) < addDays(trip.end_date, 183)) {
      out.push({ key: `passport-6m-${d.id}`, title: `Passaporte vence menos de 6 meses depois da volta`, detail: 'Alguns países exigem 6 meses de validade. Confira a regra oficial de cada destino.', link: 'documentos', cta: 'Conferir', severity: 2 });
    }
  }

  // Hospedagem: noites sem reserva ou reserva sem comprovante.
  for (const s of stops) {
    const nights = daysBetween(s.arrival_date, s.departure_date);
    if (nights <= 0) continue;
    const st = stayOf(b, s.id);
    if (!st || st.status === 'pending') {
      out.push({ key: `stay-missing-${s.id}`, title: `${st?.name && st.status === 'pending' ? st.name : `Hospedagem em ${s.name}`} sem reserva`, detail: `${nights} noite(s) em aberto, ${dayMonth(s.arrival_date)} → ${dayMonth(s.departure_date)}.`, link: 'roteiro', cta: 'Reservar', severity: 2 });
    } else if (!st.document_id && !b.documents.some((d) => d.category === 'reserva' && d.stop_id === s.id)) {
      out.push({ key: `stay-nodoc-${s.id}`, title: `Reserva em ${s.name} sem comprovante`, detail: 'Anexe o comprovante para ter offline na chegada.', link: 'documentos', cta: 'Anexar', severity: 1 });
    }
  }

  // Lacunas e sobreposições no roteiro.
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const c = stops[i + 1];
    if (c.arrival_date > a.departure_date) {
      out.push({ key: `gap-${a.id}`, title: `Dias sem parada entre ${a.name} e ${c.name}`, detail: `${dayMonth(a.departure_date)} → ${dayMonth(c.arrival_date)} sem lugar definido.`, link: 'roteiro', cta: 'Ajustar', severity: 1 });
    }
    if (c.arrival_date < a.departure_date) {
      out.push({ key: `overlap-${a.id}`, title: `${a.name} e ${c.name} se sobrepõem`, detail: `Saída de ${a.name} é ${dayMonth(a.departure_date)}, chegada em ${c.name} é ${dayMonth(c.arrival_date)}.`, link: 'roteiro', cta: 'Ajustar', severity: 2 });
    }
  }

  // Trecho longo (>= 10h) pelos horários/duração informados.
  for (const s of stops) {
    const t = arrivalOf(b, s.id);
    const min = t ? transportMinutes(t) : null;
    if (min && min >= 600) {
      out.push({ key: `long-leg-${s.id}`, title: `Trecho até ${s.name} leva ${durationLabel(min)}`, detail: 'Vale planejar comida, água e descanso na chegada.', link: 'roteiro', cta: 'Ver trecho', severity: 1 });
    }
  }

  // Orçamento.
  const cats = budgetByCategory(b.budgetCategories, b.expenses);
  for (const c of cats) {
    if (c.overPct != null && c.overPct > 0) {
      out.push({ key: `budget-cat-${c.id}`, title: `${c.name} passou ${c.overPct}% do previsto`, detail: 'Dá pra compensar nas próximas reservas ou rever o previsto.', link: 'mala', cta: 'Ver gastos', severity: 2 });
    }
  }
  const total = trip.budget_total != null ? toCents(String(trip.budget_total)) : 0;
  const spent = b.expenses.reduce((a, e) => a + toCents(String(e.base_amount)), 0);
  if (total > 0 && spent > total) {
    out.push({ key: 'budget-total', title: 'Orçamento total estourado', detail: `Gastos passaram o previsto em ${Math.round(((spent - total) / total) * 100)}%.`, link: 'mala', cta: 'Ver gastos', severity: 3 });
  }

  // Pendências vencidas.
  for (const t of b.tasks.filter((x) => x.status !== 'done' && !x.dismissed && x.due_date && x.due_date < today)) {
    out.push({ key: `task-late-${t.id}`, title: `Atrasada: ${t.title}`, detail: `Prazo era ${dayMonth(t.due_date)}.`, link: t.link, cta: 'Abrir', severity: 2 });
  }

  // Mala incompleta perto da viagem.
  const left = b.packingItems.filter((i) => !i.done).length;
  const daysTo = daysBetween(today, trip.start_date);
  if (left > 0 && daysTo >= 0 && daysTo <= 7) {
    out.push({ key: 'packing-left', title: `Mala com ${b.packingItems.length - left} de ${b.packingItems.length} itens`, detail: `Faltam ${left} item(ns) e o embarque é em ${daysTo} dia(s).`, link: 'mala', cta: 'Ver mala', severity: 2 });
  }

  return out.sort((x, y) => y.severity - x.severity);
}

/** Dica factual da parada a partir dos dados (altitude, fuso), sem inventar. */
export function ruleTip(b: TripBundle, s: Stop): { text: string; kind: 'altitude' | 'logistica' } | null {
  if (s.altitude_m != null && s.altitude_m >= 2500) {
    return { text: `${s.name} fica a ${s.altitude_m.toLocaleString('pt-BR')} m de altitude. Um primeiro dia mais leve ajuda a aclimatar.`, kind: 'altitude' };
  }
  const home = b.trip.home_tz;
  if (s.tz && home && s.tz !== home) {
    const at = Date.parse(`${s.arrival_date}T12:00:00Z`);
    const diff = tzDiffHours(home, s.tz, at);
    if (diff !== 0) {
      const h = Math.abs(diff);
      return { text: `${s.name} fica ${h.toLocaleString('pt-BR')}h ${diff < 0 ? 'atrás' : 'à frente'} do seu fuso de casa. Os horários desta parada estão no fuso local.`, kind: 'logistica' };
    }
  }
  return null;
}

export interface PackingSuggestion {
  label: string;
  group: string;
  reason: string;
}

const has = (items: PackingItem[], words: string[]) => items.some((i) => words.some((w) => normalize(i.label).includes(w)));

/** Sugestões justificadas pelos dados. Só aparecem; entram na mala com um clique do usuário. */
export function rulePacking(b: TripBundle): PackingSuggestion[] {
  const out: PackingSuggestion[] = [];
  const stops = sortedStops(b);
  const items = b.packingItems;
  const high = stops.filter((s) => (s.altitude_m ?? 0) >= 3000);
  if (high.length) {
    const names = high.map((s) => `${s.name} (${s.altitude_m!.toLocaleString('pt-BR')} m)`).join(', ');
    if (!has(items, ['protetor labial'])) out.push({ label: 'Protetor labial', group: 'Farmácia', reason: `Paradas acima de 3.000 m: ${names}. Ar seco e sol forte na altitude.` });
    if (!has(items, ['segunda pele', 'termic'])) out.push({ label: 'Segunda pele', group: 'Roupas', reason: `Paradas acima de 3.000 m: ${names}. Altitude costuma ter noites frias.` });
  }
  const countries = Array.from(new Set(stops.map((s) => s.country?.split('·')[0].trim()).filter(Boolean)));
  if (countries.length >= 1 && !has(items, ['passaporte', 'rg', 'identidade'])) {
    out.push({ label: 'Passaporte ou RG', group: 'Documentos', reason: `Roteiro passa por: ${countries.join(', ')}.` });
  }
  const acts = b.activities.map((a) => normalize(`${a.title} ${a.notes ?? ''}`)).join(' | ');
  if (/trilha|trek|montanha|caminhada|hike|vulcao/.test(acts) && !has(items, ['bota', 'tenis de trilha'])) {
    out.push({ label: 'Bota de trilha', group: 'Roupas', reason: 'Há atividades de trilha/caminhada no plano.' });
  }
  if (/praia|termas|piscina|banho|lagoa|hot spring|onsen|hammam/.test(acts) && !has(items, ['roupa de banho', 'biquini', 'sunga', 'maio'])) {
    out.push({ label: 'Roupa de banho', group: 'Roupas', reason: 'Há praia, termas ou banho no plano.' });
  }
  const overnight = b.transports.filter((t) => t.mode === 'bus' && ((t.depart_time && t.depart_time >= '20:00') || (t.arrive_date && t.depart_date && t.arrive_date > t.depart_date)));
  if (overnight.length && !has(items, ['travesseiro'])) {
    out.push({ label: 'Travesseiro de pescoço', group: 'Equipamento', reason: `Ônibus noturno: ${overnight.length} trecho(s) saindo à noite ou chegando no dia seguinte.` });
  }
  if (b.transports.some((t) => t.mode === 'plane') && !has(items, ['carregador', 'power bank'])) {
    out.push({ label: 'Power bank (na bagagem de mão)', group: 'Equipamento', reason: 'Há voos no roteiro; baterias externas costumam ir na bagagem de mão.' });
  }
  return out;
}

/** Retrospectiva por regras: trajeto e números reais, sem adjetivos inventados. */
export function ruleRetro(b: TripBundle) {
  const stops = sortedStops(b);
  const days = daysBetween(b.trip.start_date, b.trip.end_date) + 1;
  const photos = b.journalPhotos.length;
  const favs = b.journalEntries.filter((e) => e.favorite).length;
  return {
    title: `${b.trip.title}: ${days} dias, ${stops.length} paradas`,
    intro: `De ${dayMonth(b.trip.start_date)} a ${dayMonth(b.trip.end_date)}${stops.length ? `, de ${stops[0].name} até ${stops.at(-1)!.name}` : ''}.`,
    chapters: stops.map((s) => {
      const entries = b.journalEntries.filter((e) => e.stop_id === s.id && e.body);
      const firstLine = entries[0]?.body?.split('\n')[0]?.slice(0, 160);
      return {
        stop_id: s.id,
        heading: s.name,
        text: firstLine ? `“${firstLine}”` : `${daysBetween(s.arrival_date, s.departure_date)} noite(s), ${dayMonth(s.arrival_date)} → ${dayMonth(s.departure_date)}.`,
      };
    }),
    closing: `${photos} foto(s) no diário, ${favs} registro(s) favorito(s).`,
  };
}
