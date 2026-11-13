'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Icon } from './primitives';
import s from './ScreenHeader.module.css';

/**
 * Cabeçalho de tela: título grande, subtítulo e ação à direita (planning §3.3).
 * `back` (href) mostra o botão voltar redondo — usado nas subtelas.
 */
export function ScreenHeader({ title, subtitle, eyebrow, action, back, backLabel = 'Voltar', children, inlineAction = false }: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  eyebrow?: React.ReactNode;
  action?: React.ReactNode;
  /** href da tela anterior; `true` usa o histórico */
  back?: string | true;
  backLabel?: string;
  children?: React.ReactNode;
  /** Ação curta ao lado do título, com subtítulo ocupando a linha inteira. */
  inlineAction?: boolean;
}) {
  const router = useRouter();
  return (
    <header className={`${s.head} ${back ? s.withBack : ''}`}>
      {back ? (
        <div className={s.bar}>
          {back === true ? (
            <button type="button" className={s.back} aria-label={backLabel} onClick={() => router.back()}><Icon name="back" size={22} /></button>
          ) : (
            <Link href={back} className={s.back} aria-label={backLabel}><Icon name="back" size={22} /></Link>
          )}
          {action ? <div className={s.action}>{action}</div> : null}
        </div>
      ) : null}
      <div className={`${s.main} ${inlineAction && !back ? s.inlineAction : ''}`}>
        <div className={s.titles}>
          {eyebrow ? <div className={s.eyebrow}>{eyebrow}</div> : null}
          <h1 className={back ? s.subTitle : s.title}>{title}</h1>
          {subtitle ? <p className={s.sub}>{subtitle}</p> : null}
        </div>
        {action && !back ? <div className={s.action}>{action}</div> : null}
      </div>
      {children}
    </header>
  );
}
