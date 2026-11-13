import type { TripBundle, BudgetPlan } from './types';
import type { TripSource } from './source';
import { categoryKind, formatMoney, toCents } from '../lib/money';
import { snapshotOf, type PlanResult } from '../lib/budgetPlan';
export const BUDGET_LABELS = { transporte: 'Transporte', hospedagem: 'Hospedagem', passeios: 'Passeios', comida: 'Comida e compras' };
export const BUDGET_COLORS = { transporte: '#8E9BFF', hospedagem: '#FF6B3D', passeios: '#4FC08D', comida: '#E3E6EB' };
export interface BudgetWrite {
  p_trip: string; p_version: number; p_plan: BudgetPlan; p_question: string | null;
  p_categories: { id: string; version: number | null; name: string; kind: string; color: string; position: number; planned: string }[];
  p_transports: { id: string; version: number; cents: number | null }[];
}
/** Uma transação: preços digitados, categorias, respostas e votação. O teto nunca é escrito. */
export async function closeBudget(source: TripSource, b: TripBundle, plan: BudgetPlan, result: PlanResult, typed: Record<string, string>) {
  const categories: BudgetWrite['p_categories'] = [];
  for (const [position, l] of result.lines.entries()) {
    const matches = b.budgetCategories.filter((c) => categoryKind(c) === l.kind).sort((a, c) => a.position - c.position);
    if (matches.length) for (const [i, c] of matches.entries()) categories.push({ ...c, kind: l.kind, planned: (i === 0 ? l.perPersonCents * result.people / 100 : 0).toFixed(2) });
    else categories.push({ id: crypto.randomUUID(), version: null, name: BUDGET_LABELS[l.kind], color: BUDGET_COLORS[l.kind], kind: l.kind, position, planned: (l.perPersonCents * result.people / 100).toFixed(2) });
  }
  const extra = b.budgetCategories.filter((c) => categoryKind(c) === 'outro').reduce((sum, c) => sum + toCents(c.planned), 0);
  const args: BudgetWrite = {
    p_trip: b.trip.id, p_version: b.trip.version, p_plan: { ...plan, snapshot: snapshotOf(b, undefined, result), updated_at: new Date().toISOString() },
    p_categories: categories,
    // Só trechos gravados; o voo virtual (ida/volta) fica em plan.transport_cents.
    p_transports: Object.entries(typed).flatMap(([id, value]) => {
      const t = b.transports.find((x) => x.id === id);
      return t ? [{ id, version: t.version, cents: value.trim() ? toCents(value) : null }] : [];
    }),
    p_question: b.members.length > 1 ? `Aprovar orçamento de ${formatMoney(Math.round((result.totalCents + extra) / result.people), b.trip.base_currency, { compact: true })} por pessoa?` : null,
  };
  await source.rpc('close_budget', { ...args });
}
