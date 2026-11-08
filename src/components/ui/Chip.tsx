'use client';
import { useId } from 'react';
import s from './Chip.module.css';

/** Pill selecionável (planning §3.3). Selecionado = fundo brand, texto branco. */
export function Chip({ selected = false, onClick, children, count, disabled, size = 'md', className, ...rest }: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & { selected?: boolean; onClick?: () => void; count?: number | string; size?: 'md' | 'sm' }) {
  return (
    <button type="button" aria-pressed={selected} disabled={disabled} onClick={onClick} className={[s.chip, size === 'sm' ? s.sm : '', className ?? ''].filter(Boolean).join(' ')} {...rest}>
      {children}
      {count !== undefined ? <span className={s.count}>{count}</span> : null}
    </button>
  );
}

export interface ChipOption<T extends string> {
  value: T;
  label: React.ReactNode;
  count?: number | string;
}

/**
 * Grupo de chips. `multiple` → cada chip é um toggle (aria-pressed);
 * senão → radiogroup com setas (um valor só).
 */
export function ChipGroup<T extends string>({ options, value, onChange, label, multiple, wrap = true, size }: {
  options: ChipOption<T>[];
  label: string;
  wrap?: boolean;
  size?: 'md' | 'sm';
} & ({ multiple: true; value: T[]; onChange: (v: T[]) => void } | { multiple?: false; value: T | null; onChange: (v: T) => void })) {
  const id = useId();
  const cls = wrap ? s.group : `${s.group} ${s.nowrap}`;
  if (multiple) {
    const sel = value as T[];
    return (
      <div role="group" aria-label={label} className={cls}>
        {options.map((o) => (
          <Chip key={o.value} size={size} count={o.count} selected={sel.includes(o.value)} onClick={() => (onChange as (v: T[]) => void)(sel.includes(o.value) ? sel.filter((x) => x !== o.value) : [...sel, o.value])}>
            {o.label}
          </Chip>
        ))}
      </div>
    );
  }
  const cur = value as T | null;
  const move = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + options.length) % options.length;
    (onChange as (v: T) => void)(options[n].value);
    (document.getElementById(`${id}-${n}`) as HTMLElement | null)?.focus();
  };
  const focusIdx = Math.max(0, options.findIndex((o) => o.value === cur));
  return (
    <div role="radiogroup" aria-label={label} className={cls}>
      {options.map((o, i) => (
        <button
          key={o.value}
          id={`${id}-${i}`}
          type="button"
          role="radio"
          aria-checked={cur === o.value}
          tabIndex={i === focusIdx ? 0 : -1}
          className={[s.chip, size === 'sm' ? s.sm : ''].filter(Boolean).join(' ')}
          onClick={() => (onChange as (v: T) => void)(o.value)}
          onKeyDown={(e) => move(e, i)}
        >
          {o.label}
          {o.count !== undefined ? <span className={s.count}>{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
