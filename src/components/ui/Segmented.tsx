'use client';
import { useId } from 'react';
import s from './Segmented.module.css';

/** Controle segmentado (Lista/Mapa, Antes/Durante/Depois). Radiogroup com setas. */
export function Segmented<T extends string>({ options, value, onChange, label, block }: { options: { value: T; label: React.ReactNode }[]; value: T; onChange: (v: T) => void; label: string; block?: boolean }) {
  const id = useId();
  const key = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + options.length) % options.length;
    onChange(options[n].value);
    document.getElementById(`${id}-${n}`)?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className={`${s.seg} ${block ? s.block : ''}`}>
      {options.map((o, i) => (
        <button key={o.value} id={`${id}-${i}`} type="button" role="radio" aria-checked={value === o.value} tabIndex={value === o.value ? 0 : -1} onClick={() => onChange(o.value)} onKeyDown={(e) => key(e, i)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
