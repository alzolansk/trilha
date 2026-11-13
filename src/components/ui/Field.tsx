import s from './Field.module.css';

/**
 * Campo de formulário (rótulo + controle + dica/erro). O controle vai como filho (input, select, textarea),
 * e herda o visual: 48 px, fundo `--field`, contorno brand no foco. Substitui a classe antiga `.field`.
 */
export function Field({ label, hint, error, children, className }: { label: React.ReactNode; hint?: React.ReactNode; error?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <label className={[s.field, className ?? ''].filter(Boolean).join(' ')}>
      <span className={s.label}>{label}</span>
      {children}
      {error ? <span className={s.err} role="alert">{error}</span> : hint ? <span className={s.hint}>{hint}</span> : null}
    </label>
  );
}

/** Grade de campos: 2 colunas quando cabe, 1 no celular estreito. */
export function FieldGrid({ children }: { children: React.ReactNode }) {
  return <div className={s.grid}>{children}</div>;
}
