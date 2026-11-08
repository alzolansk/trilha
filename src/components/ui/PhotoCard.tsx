import Link from 'next/link';
import { Photo, type PhotoData } from './Photo';
import s from './PhotoCard.module.css';

/** Foto grande com título e ações embaixo (passeio, destino, bairro). `row`: miniatura de 84 px à esquerda. */
export function PhotoCard({ photo, place, title, meta, badge, actions, href, variant = 'large', selected, children }: {
  photo?: PhotoData | null;
  place?: string;
  title: React.ReactNode;
  meta?: React.ReactNode;
  /** selo sobre a foto (grande) ou acima do título (row) */
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  href?: string;
  variant?: 'large' | 'row';
  selected?: boolean;
  children?: React.ReactNode;
}) {
  const head = href ? <Link href={href} className={s.link}>{title}</Link> : title;
  if (variant === 'row') {
    return (
      <article className={`${s.row} ${selected ? s.selected : ''}`}>
        <Photo photo={photo} place={place} height={84} radius="var(--r-thumb)" caption={false} className={s.thumb} />
        <div className={s.rowBody}>
          {badge ? <div>{badge}</div> : null}
          <h3 className={s.rowTitle}>{head}</h3>
          {meta ? <div className={s.meta}>{meta}</div> : null}
          {children}
        </div>
        {actions ? <div className={s.rowActions}>{actions}</div> : null}
      </article>
    );
  }
  return (
    <article className={`${s.card} ${selected ? s.selected : ''}`}>
      <Photo photo={photo} place={place} ratio="16/9" radius="0">
        {badge ? <div className={s.badge}>{badge}</div> : null}
      </Photo>
      <div className={s.body}>
        <h3 className={s.title}>{head}</h3>
        {meta ? <div className={s.meta}>{meta}</div> : null}
        {children}
        {actions ? <div className={s.actions}>{actions}</div> : null}
      </div>
    </article>
  );
}
