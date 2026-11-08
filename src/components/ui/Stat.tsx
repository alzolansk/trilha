import s from './Stat.module.css';

/** Rótulo pequeno com valor grande (números em tabular-nums). */
export function Stat({ label, value, sub, tone = 'default', size = 'md' }: { label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode; tone?: 'default' | 'on-dark'; size?: 'md' | 'lg' }) {
  return (
    <div className={[s.stat, tone === 'on-dark' ? s.dark : '', size === 'lg' ? s.lg : ''].filter(Boolean).join(' ')}>
      <span className={s.label}>{label}</span>
      <span className={s.value}>{value}</span>
      {sub ? <span className={s.sub}>{sub}</span> : null}
    </div>
  );
}
