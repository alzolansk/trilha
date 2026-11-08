import s from './Badge.module.css';

export type BadgeTone = 'ok' | 'warn' | 'brand' | 'sun' | 'neutral' | 'dark' | 'light';

/** Selo pequeno. `upper` só para selos de sistema (ESTIMATIVA, IA). */
export function Badge({ tone = 'neutral', upper = false, children, className, title }: { tone?: BadgeTone; upper?: boolean; children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={[s.badge, s[tone], upper ? s.upper : '', className ?? ''].filter(Boolean).join(' ')}>
      {children}
    </span>
  );
}

/** Selo ESTIMATIVA (regra de honestidade, planning decisão 3). */
export function EstimateBadge() {
  return <Badge tone="sun" upper title="Valor estimado. Confirme antes de reservar.">Estimativa</Badge>;
}
