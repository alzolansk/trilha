'use client';
import { useEffect, useId, useMemo, useRef } from 'react';
import { patternSvg } from '../../lib/identity/render';
import type { DestinationIdentity } from '../../lib/identity/types';
import { initials } from '../../lib/format';
import { ICONS, type IconName } from './icons.data';

export function Icon({ name, size = 20, sw = 1.8, fill = 'none', className }: { name: IconName; size?: number; sw?: number; fill?: string; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      style={{ flex: 'none', fill, stroke: 'currentColor', strokeWidth: sw, strokeLinecap: 'round', strokeLinejoin: 'round' }}
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}

/**
 * Nota contextual. `by="ai"` mostra a etiqueta IA (conteúdo realmente gerado por modelo);
 * `by="rules"` mostra AUTO (calculado por regra a partir dos seus dados).
 */
export function AiNote({ by = 'ai', children, source }: { by?: 'ai' | 'rules'; children: React.ReactNode; source?: string | null }) {
  return (
    <div className="ai">
      <AiTag by={by} solid />
      <span>
        {children}
        {source ? <small>{by === 'ai' ? 'Confira em' : 'Fonte'}: {source}</small> : null}
      </span>
    </div>
  );
}

export function AiTag({ by = 'ai', solid = false }: { by?: 'ai' | 'rules'; solid?: boolean }) {
  const label = by === 'ai' ? 'IA' : 'AUTO';
  const title = by === 'ai' ? 'Gerado por IA. Confira e edite à vontade.' : 'Calculado por regra a partir dos dados da trilha.';
  if (!solid) return <span className="tag" data-src={by} title={title}>{label}</span>;
  return (
    <span className="ai-tag" data-src={by} title={title}>
      {by === 'ai' ? <Icon name="sparkle" size={10} sw={1.4} fill="currentColor" /> : null}
      {label}
    </span>
  );
}

export function Pattern({ identity, opacity, style }: { identity: DestinationIdentity; opacity?: number; style?: React.CSSProperties }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const html = useMemo(() => patternSvg(identity, uid), [identity, uid]);
  return <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', opacity, ...style }} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function Marquee({ words }: { words: string[] }) {
  if (!words.length) return null;
  const w = [...words, ...words, ...words];
  return (
    <div className="marquee" aria-hidden="true">
      <div className="marquee-in">
        {w.map((x, i) => (
          <span key={i}>
            {x}
            <i />
          </span>
        ))}
      </div>
    </div>
  );
}

export type FloatSpot = [left: string, top: string, size: number, color: 'acc' | 'acc2' | 'acc3', opacity: number, speed: number];
export const PAGE_FLOAT: FloatSpot[] = [
  ['-60px', '160px', 160, 'acc2', 0.55, -0.25],
  ['88%', '420px', 110, 'acc', 0.5, 0.15],
  ['6%', '1100px', 90, 'acc3', 0.45, -0.2],
  ['80%', '1500px', 180, 'acc2', 0.35, -0.3],
  ['42%', '760px', 60, 'acc', 0.5, 0.2],
];

/** Motifs flutuantes de fundo com parallax (máx. 5 por página, SPEC §7). */
export function Floaters({ spots = PAGE_FLOAT }: { spots?: FloatSpot[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const items = Array.from(el.querySelectorAll<HTMLElement>('.floater'));
    let ticking = false;
    const run = () => {
      ticking = false;
      const s = window.scrollY;
      for (const f of items) f.style.transform = `translateY(${Math.round(s * Number(f.dataset.speed))}px)`;
    };
    const on = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(run);
      }
    };
    window.addEventListener('scroll', on, { passive: true });
    run();
    return () => window.removeEventListener('scroll', on);
  }, []);
  return (
    <div className="floaters" aria-hidden="true" ref={ref}>
      {spots.slice(0, 5).map((f, i) => (
        <div key={i} className="floater" data-speed={f[5]} style={{ left: f[0], top: f[1], width: f[2], height: f[2] }}>
          <i style={{ background: `var(--${f[3]})`, opacity: f[4], animationDelay: `-${i * 1.7}s`, animationDuration: `${7 + (i % 4)}s` }} />
        </div>
      ))}
    </div>
  );
}

/** Revela elementos .rv uma única vez ao entrarem na tela (SPEC §10). */
export function useReveal(deps: unknown[] = []) {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('.rv:not(.in)'));
    const vh = window.innerHeight;
    // O que já está visível no primeiro paint fica visível (sem esconder e reaparecer).
    for (const e of els) {
      const r = e.getBoundingClientRect();
      if (r.top < vh && r.bottom > 0) e.classList.add('in');
    }
    document.documentElement.classList.add('rv-ready');
    if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      els.forEach((e) => e.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      }),
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    );
    els.filter((e) => !e.classList.contains('in')).forEach((e) => io.observe(e));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function MotifCheck({ checked, onChange, label, disabled, children, type = 'checkbox', name, className }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; children?: React.ReactNode; type?: 'checkbox' | 'radio'; name?: string; className?: string }) {
  return (
    <label className={className ? `check ${className}` : 'check'}>
      <input type={type} name={name} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="box" aria-hidden="true" />
      <span className="lbl" style={{ flex: 1 }}>{label}</span>
      {children}
    </label>
  );
}

export function Avatar({ name, color, size = 36 }: { name: string; color: string; size?: number }) {
  return (
    <span className="av" title={name} style={{ width: size, height: size, background: color, color: 'var(--ink)' }}>
      <span style={{ color: 'inherit', mixBlendMode: 'normal' }}>{initials(name)}</span>
    </span>
  );
}

export function Skeleton({ h = 120, w = '100%', r }: { h?: number | string; w?: number | string; r?: number }) {
  return <div className="skel" aria-hidden="true" style={{ height: h, width: w, borderRadius: r }} />;
}

export function PageTitle({ eyebrow, title, sub, actions }: { eyebrow?: React.ReactNode; title: string; sub?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="page-title">
      <div className="rv">
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1 className="disp">
          {title}
          <span className="motif" aria-hidden="true" />
        </h1>
        {sub ? <p>{sub}</p> : null}
      </div>
      {actions ? <div className="actions">{actions}</div> : null}
    </section>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="errbox" role="alert">
      <Icon name="alert" />
      <span style={{ flex: 1 }}>{message}</span>
      {onRetry ? (
        <button className="btn btn-sm tap" onClick={onRetry}>
          Tentar de novo
        </button>
      ) : null}
    </div>
  );
}
