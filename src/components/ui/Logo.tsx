/** Marca da Trilha: quadrado ultramar, trilha pontilhada branca e ponto tangerina. */
export function LogoMark({ size = 32, inverted = false }: { size?: number; inverted?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" style={{ flex: 'none' }}>
      <rect width="40" height="40" rx="12" fill={inverted ? 'var(--surface)' : 'var(--brand)'} />
      <path d="M9 29C15 29 14 18 20 18S26 11 31 11" fill="none" stroke={inverted ? 'var(--brand)' : 'var(--on-brand)'} strokeWidth="3" strokeLinecap="round" strokeDasharray="0.1 5.5" />
      <circle cx="31" cy="11" r="3.5" fill="var(--sun)" />
    </svg>
  );
}

export function Logo({ size = 32, inverted = false, label = true }: { size?: number; inverted?: boolean; label?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <LogoMark size={size} inverted={inverted} />
      {label ? <span style={{ font: `800 ${Math.round(size * 0.72)}px/1 var(--font-title)`, letterSpacing: '-0.03em' }}>trilha</span> : null}
    </span>
  );
}
