import s from './Progress.module.css';

export interface ProgressLayer {
  /** 0–1 */
  value: number;
  /** token de cor, ex. 'var(--sun)' */
  color: string;
  label?: string;
}

/**
 * Trilho de 8–14 px. `layers` empilha camadas (ex.: juntado por baixo, gasto por cima);
 * `segments` divide o trilho por categoria (somam até 1).
 */
export function Progress({ value, color = 'var(--brand)', layers, segments, height = 8, track = 'var(--field)', label }: {
  value?: number;
  color?: string;
  layers?: ProgressLayer[];
  segments?: ProgressLayer[];
  height?: 8 | 10 | 12 | 14;
  track?: string;
  label: string;
}) {
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const pct = (v: number) => `${(clamp(v) * 100).toFixed(2)}%`;
  const now = value ?? layers?.[layers.length - 1]?.value ?? segments?.reduce((a, x) => a + x.value, 0) ?? 0;
  return (
    <div className={s.track} style={{ height, background: track }} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clamp(now) * 100)}>
      {segments ? (
        <div className={s.segs}>
          {segments.map((x, i) => <i key={i} title={x.label} style={{ width: pct(x.value), background: x.color }} />)}
        </div>
      ) : layers ? (
        layers.map((x, i) => <i key={i} className={s.fill} title={x.label} style={{ width: pct(x.value), background: x.color }} />)
      ) : (
        <i className={s.fill} style={{ width: pct(value ?? 0), background: color }} />
      )}
    </div>
  );
}
