'use client';
import { useEffect, useId, useState } from 'react';
import s from './MoneyInput.module.css';

const SYMBOL: Record<string, string> = { BRL: 'R$', USD: 'US$', EUR: '€', PEN: 'S/', BOB: 'Bs', ARS: '$', CLP: '$', JPY: '¥', MAD: 'DH', ISK: 'kr' };
export const currencySymbol = (c: string) => SYMBOL[c] ?? c;

/** "1.234,5" → 123450 (centavos). Aceita vírgula ou ponto como decimal. */
export function parseMoneyInput(text: string): number | null {
  const t = text.replace(/[^\d,.]/g, '');
  if (!t) return null;
  const lastSep = Math.max(t.lastIndexOf(','), t.lastIndexOf('.'));
  const hasDecimals = lastSep >= 0 && t.length - lastSep - 1 <= 2 && (t[lastSep] === ',' || t.split('.').length === 2 && !t.includes(','));
  const int = (hasDecimals ? t.slice(0, lastSep) : t).replace(/[.,]/g, '');
  const dec = hasDecimals ? t.slice(lastSep + 1).padEnd(2, '0') : '00';
  const v = Number(int || '0') * 100 + Number(dec);
  return Number.isFinite(v) ? v : null;
}

/** Formata enquanto digita: milhar com ponto, decimal com vírgula (pt-BR). */
export function formatMoneyTyping(text: string): string {
  const clean = text.replace(/[^\d,]/g, '');
  const [int = '', ...dec] = clean.split(',');
  const intFmt = int.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return dec.length ? `${intFmt || '0'},${dec.join('').slice(0, 2)}` : intFmt;
}

const centsToText = (c: number | null) => (c == null ? '' : formatMoneyTyping((c / 100).toFixed(2).replace('.', ',').replace(/,00$/, '')));

/**
 * Próximo texto do campo depois de uma edição. `prev` é o texto formatado anterior, `value` o que o
 * navegador entregou e `caret` a posição do cursor depois da edição.
 * O teclado decimal do celular às vezes só tem ".", então um ponto RECÉM-DIGITADO vira a vírgula decimal.
 * Os pontos que já estavam lá são separadores de milhar postos pela formatação: saem e são refeitos
 * (antes, "2.000" + "0" virava "2,0000" → "2,00").
 */
export function nextMoneyText(prev: string, value: string, caret: number | null): string {
  if (value.includes(',')) return formatMoneyTyping(value);
  // Colou um valor inteiro (ex.: "1234.56" ou "1.234"): interpreta como número.
  if (value.length - prev.length > 1) {
    const cents = parseMoneyInput(value);
    return cents == null ? '' : centsToText(cents);
  }
  const at = (caret ?? value.length) - 1;
  if (value.length > prev.length && value[at] === '.') {
    return formatMoneyTyping(`${value.slice(0, at).replace(/\./g, '')},${value.slice(at + 1).replace(/\./g, '')}`);
  }
  return formatMoneyTyping(value);
}

/** Valor grande (40 px), teclado decimal, prefixo de moeda trocável e formatação pt-BR enquanto digita. */
export function MoneyInput({ label, value, onChange, currency = 'BRL', onCurrencyClick, autoFocus, hint, error, hideLabel }: {
  label: string;
  /** centavos */
  value: number | null;
  onChange: (cents: number | null) => void;
  currency?: string;
  /** torna o prefixo um botão para trocar a moeda */
  onCurrencyClick?: () => void;
  autoFocus?: boolean;
  hint?: React.ReactNode;
  error?: string | null;
  hideLabel?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(() => centsToText(value));
  useEffect(() => {
    if (parseMoneyInput(text) !== value) setText(centsToText(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const sym = currencySymbol(currency);
  return (
    <div className={s.wrap}>
      <label htmlFor={id} className={hideLabel ? 'sr' : s.label}>{label}</label>
      <div className={`${s.box} ${error ? s.bad : ''}`}>
        {onCurrencyClick ? (
          <button type="button" className={s.cur} onClick={onCurrencyClick} aria-label={`Moeda: ${currency}. Trocar`}>{sym}</button>
        ) : (
          <span className={s.cur} aria-hidden="true">{sym}</span>
        )}
        <input
          id={id}
          className={s.input}
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="done"
          placeholder="0"
          autoFocus={autoFocus}
          value={text}
          aria-invalid={!!error || undefined}
          aria-describedby={hint || error ? `${id}-h` : undefined}
          onChange={(e) => {
            const f = nextMoneyText(text, e.target.value, e.target.selectionStart);
            setText(f);
            onChange(parseMoneyInput(f));
          }}
        />
      </div>
      {error ? <span id={`${id}-h`} className={s.err}>{error}</span> : hint ? <span id={`${id}-h`} className={s.hint}>{hint}</span> : null}
    </div>
  );
}
