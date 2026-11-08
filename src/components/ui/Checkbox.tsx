'use client';
import s from './Checkbox.module.css';

/** Caixa de 24 px, raio 7, check branco sobre brand (substitui o MotifCheck). `type="radio"` vira bolinha. */
export function Checkbox({ checked, onChange, label, disabled, children, type = 'checkbox', name, className, strike = false, hideLabel = false }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
  children?: React.ReactNode;
  type?: 'checkbox' | 'radio';
  name?: string;
  className?: string;
  /** risca o rótulo quando marcado (itens de mala) */
  strike?: boolean;
  hideLabel?: boolean;
}) {
  return (
    <label className={[s.check, strike ? s.strike : '', className ?? ''].filter(Boolean).join(' ')}>
      <input type={type} name={name} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className={s.box} aria-hidden="true" />
      <span className={hideLabel ? 'sr' : s.lbl}>{label}</span>
      {children}
    </label>
  );
}
