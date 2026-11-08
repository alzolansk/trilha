'use client';
import { useState } from 'react';
import { useBundle } from '../../data/TripContext';
import { formatMoney, toCents } from '../../lib/money';
import { useFx } from './useFx';
import s from './money.module.css';
export function Converter() {
  const { bundle: b } = useBundle();
  const { fx, err } = useFx(b.trip.base_currency);
  const [amount, setAmount] = useState('100');
  const [currency, setCurrency] = useState('USD');
  const rate = fx?.rates[currency];
  return <details className={s.panel}><summary>Conversor de moedas</summary><div className={s.form}>
    <label className="field">Valor ({b.trip.base_currency})<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
    <label className="field">Converter para<select value={currency} onChange={(e) => setCurrency(e.target.value)}>{[...new Set([currency, ...Object.keys(fx?.rates ?? {})])].map((c) => <option key={c}>{c}</option>)}</select></label>
    <p>{rate && Number.isFinite(toCents(amount)) ? `≈ ${formatMoney(Math.round(toCents(amount) * rate), currency)} · ${fx?.date}, fonte ${fx?.source}` : err ? 'Cotação indisponível agora. Tente novamente mais tarde.' : 'Carregando cotação…'}</p>
  </div></details>;
}
