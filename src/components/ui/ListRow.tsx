import Link from 'next/link';
import { Icon } from './primitives';
import type { IconName } from './icons.data';
import s from './ListRow.module.css';

/**
 * Linha de lista: ícone ou miniatura, título, subtítulo e elemento à direita (valor, chevron, selo).
 * Com `href` ou `onClick` a linha inteira é clicável (alvo ≥ 44 px).
 */
export function ListRow({ icon, iconTone = 'brand', thumb, eyebrow, eyebrowTone = 'brand', title, subtitle, right, chevron, href, onClick, divider = true, card = false }: {
  icon?: IconName;
  iconTone?: 'brand' | 'sun' | 'ok' | 'neutral' | 'dark';
  /** miniatura (ex.: <Photo height={64} />) no lugar do ícone */
  thumb?: React.ReactNode;
  eyebrow?: React.ReactNode;
  eyebrowTone?: 'brand' | 'warn' | 'ok' | 'mute';
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  chevron?: boolean;
  href?: string;
  onClick?: () => void;
  divider?: boolean;
  /** linha como cartão próprio (Início) em vez de item de lista */
  card?: boolean;
}) {
  const body = (
    <>
      {thumb ? <span className={s.thumb}>{thumb}</span> : icon ? <span className={`${s.icon} ${s[`t_${iconTone}`]}`}><Icon name={icon} size={card ? 26 : 20} /></span> : null}
      <span className={s.text}>
        {eyebrow ? <span className={`${s.eyebrow} ${s[`e_${eyebrowTone}`]}`}>{eyebrow}</span> : null}
        <span className={s.title}>{title}</span>
        {subtitle ? <span className={s.sub}>{subtitle}</span> : null}
      </span>
      {right ? <span className={s.right}>{right}</span> : null}
      {chevron || ((href || onClick) && !right) ? <Icon name="next" size={20} className={s.chev} /> : null}
    </>
  );
  const cls = [s.row, divider && !card ? s.divider : '', card ? s.card : '', href || onClick ? s.action : ''].filter(Boolean).join(' ');
  if (href) return <Link href={href} className={cls}>{body}</Link>;
  if (onClick) return <button type="button" className={cls} onClick={onClick}>{body}</button>;
  return <div className={cls}>{body}</div>;
}
