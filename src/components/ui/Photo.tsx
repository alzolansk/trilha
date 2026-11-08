'use client';
import { useState } from 'react';
import { photoSrcSet } from '../../lib/photos';
import { Icon } from './primitives';
import s from './Photo.module.css';

/** Foto resolvida (Wikimedia Commons ou upload). Crédito é obrigatório quando vem de terceiros. */
export interface PhotoData {
  url: string;
  width?: number | null;
  height?: number | null;
  author?: string | null;
  license?: string | null;
  source_url?: string | null;
}

/**
 * Imagem com `object-fit: cover`, legenda "foto · {lugar}" e crédito (autor e licença) no botão ⓘ.
 * Sem foto, desenha o placeholder ilustrado na `--trip-accent`. Reserva o espaço (sem CLS).
 */
export function Photo({ photo, place, alt, ratio, height, radius = 'var(--r-thumb)', caption = true, overlay = false, priority = false, sizes = '(min-width: 1024px) 480px, 100vw', className, children }: {
  photo?: PhotoData | null;
  /** nome do lugar, usado na legenda e no alt */
  place?: string;
  alt?: string;
  /** ex.: "16/9"; ignorado quando `height` é dado */
  ratio?: string;
  height?: number | string;
  radius?: string;
  caption?: boolean;
  /** escurece a base só o necessário para texto branco por cima (4.5:1) */
  overlay?: boolean;
  priority?: boolean;
  /** atributo `sizes` do srcset (só vale para fotos da Wikimedia) */
  sizes?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  const [plain, setPlain] = useState(false);
  const [credit, setCredit] = useState(false);
  const has = !!photo?.url && !failed;
  const style: React.CSSProperties = { borderRadius: radius, ...(height !== undefined ? { height } : { aspectRatio: ratio ?? '4/3' }) };
  const srcSet = !plain && photo?.url ? photoSrcSet(photo.url) : null;
  const hasCredit = has && (photo?.author || photo?.license);
  return (
    <figure className={`${s.photo} ${className ?? ''}`} style={style}>
      {has ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className={s.img}
          src={photo!.url}
          srcSet={srcSet ?? undefined}
          sizes={srcSet ? sizes : undefined}
          alt={alt ?? (place ? `Foto de ${place}` : '')}
          width={photo!.width ?? undefined}
          height={photo!.height ?? undefined}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          onError={() => (srcSet ? setPlain(true) : setFailed(true))}
        />
      ) : (
        <Placeholder label={alt ?? (place ? `Ilustração: ${place} (sem foto)` : undefined)} />
      )}
      {overlay ? <span className={s.overlay} aria-hidden="true" /> : null}
      {children ? <div className={s.content}>{children}</div> : null}
      {caption && place && has ? <figcaption className={s.caption}>foto · {place}</figcaption> : null}
      {hasCredit ? (
        <>
          <button type="button" className={s.info} aria-label="Crédito da foto" aria-expanded={credit} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setCredit((v) => !v); }}>
            <Icon name="info" size={14} />
          </button>
          {credit ? (
            <span className={s.credit} role="note">
              {photo!.author ? <>Foto: {photo!.author}</> : null}
              {photo!.license ? <> · {photo!.license}</> : null}
              {photo!.source_url ? <> · <a href={photo!.source_url} target="_blank" rel="noopener noreferrer">fonte</a></> : null}
            </span>
          ) : null}
        </>
      ) : null}
    </figure>
  );
}

/** Silhuetas em camadas na cor da trilha (como no canvas). */
export function Placeholder({ label }: { label?: string }) {
  return (
    <svg className={s.ph} viewBox="0 0 400 300" preserveAspectRatio="xMidYMax slice" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <rect width="400" height="300" className={s.l0} />
      <path d="M0 175 L70 110 L120 150 L190 70 L250 135 L300 105 L400 160 L400 300 L0 300 Z" className={s.l1} />
      <path d="M190 70 L172 94 L206 94 Z M70 110 L58 124 L82 124 Z" className={s.snow} />
      <path d="M0 215 L90 180 L170 215 L260 175 L400 210 L400 300 L0 300 Z" className={s.l2} />
      <path d="M0 245 L400 230 L400 300 L0 300 Z" className={s.l3} />
    </svg>
  );
}
