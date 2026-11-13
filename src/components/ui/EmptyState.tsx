import { Icon } from './primitives';
import type { IconName } from './icons.data';
import s from './EmptyState.module.css';

/** Vazio com ilustração de traço, frase e uma CTA (planning §6.8). */
export function EmptyState({ icon = 'route', title, text, action, compact }: { icon?: IconName; title: string; text?: React.ReactNode; action?: React.ReactNode; compact?: boolean }) {
  return (
    <div className={`${s.empty} ${compact ? s.compact : ''}`}>
      <span className={s.art} aria-hidden="true"><Icon name={icon} size={compact ? 24 : 32} /></span>
      <h3 className={s.title}>{title}</h3>
      {text ? <p className={s.text}>{text}</p> : null}
      {action ? <div className={s.action}>{action}</div> : null}
    </div>
  );
}
