'use client';
import { useEffect } from 'react';
import { ICONS, type IconName } from './icons.data';

export function Icon({ name, size = 20, sw = 2, fill = 'none', className }: { name: IconName; size?: number; sw?: number; fill?: string; className?: string }) {
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

/** @deprecated reveal da fase rústica; no visual novo `.rv` já aparece direto. Sai com as telas antigas. */
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

// Avatar, Skeleton e ErrorBox ganharam arquivos próprios (Trilha 2.0); reexportados para as telas antigas.
export { Avatar } from './Avatar';
export { Skeleton } from './Skeleton';
export { ErrorBox } from './ErrorBox';

/** @deprecated use `ScreenHeader`. Mantido para as telas ainda não redesenhadas. */
export function PageTitle({ eyebrow, title, sub, actions }: { eyebrow?: React.ReactNode; title: string; sub?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="page-title">
      <div className="rv">
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1 className="disp">
          {title}
        </h1>
        {sub ? <p>{sub}</p> : null}
      </div>
      {actions ? <div className="actions">{actions}</div> : null}
    </section>
  );
}
