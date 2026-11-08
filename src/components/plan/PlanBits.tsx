'use client';
import { rangeLabel, type Fit } from '../../lib/explore';
import { formatMoney } from '../../lib/money';
import s from './plan.module.css';

/** Selo "grátis / cabe / passa R$ x" a partir do topo da faixa estimada. */
export function FitBadge({ fit, high, cap, currency }: { fit: Fit; high: number; cap: number; currency: string }) {
  if (fit === 'unknown') return null;
  const text = fit === 'free' ? 'grátis' : fit === 'fits' ? 'cabe' : `passa ${formatMoney(high - cap, currency, { compact: true })}`;
  return <span className={s.fit} data-fit={fit}>{text}</span>;
}

export function Estimate({ low, high, currency, suffix }: { low: number; high: number; currency: string; suffix?: string }) {
  return (
    <span className={s.est}>
      <b>{rangeLabel(low, high, currency)}</b>
      {suffix ? <span> {suffix}</span> : null}
    </span>
  );
}

/** Rodapé honesto de toda lista de sugestão da IA. */
export function EstimateNote({ model }: { model?: string }) {
  return (
    <p className={s.note}>
      <span className={s.estTag}>ESTIMATIVA</span>
      Sugestões da IA{model ? ` (${model})` : ''} a partir de conhecimento geral, não de preços ao vivo. Confira valores e horários antes de reservar.
    </p>
  );
}
