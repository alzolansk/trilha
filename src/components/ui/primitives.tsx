'use client';
import { ICONS, type IconName } from './icons.data';
import s from './primitives.module.css';

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
    <div className={s.ai}>
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
  if (!solid) return <span className={s.tag} data-src={by} title={title}>{label}</span>;
  return (
    <span className={s.aiTag} data-src={by} title={title}>
      {by === 'ai' ? <Icon name="sparkle" size={10} sw={1.4} fill="currentColor" /> : null}
      {label}
    </span>
  );
}

// Avatar, Skeleton e ErrorBox ganharam arquivos próprios (Trilha 2.0); reexportados para as telas antigas.
export { Avatar } from './Avatar';
export { Skeleton } from './Skeleton';
export { ErrorBox } from './ErrorBox';
