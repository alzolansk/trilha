'use client';
import { useEffect, useRef, useState } from 'react';
import { isUnsplashImage, parseRatio, photoSrc, photoSrcSet, UNSPLASH_UTM } from '../../lib/photos';
import { Icon } from './primitives';
import s from './Photo.module.css';

/** Foto resolvida (Unsplash, Wikimedia Commons ou upload). Crédito é obrigatório quando vem de terceiros. */
export interface PhotoData {
  url: string;
  width?: number | null;
  height?: number | null;
  author?: string | null;
  license?: string | null;
  source_url?: string | null;
  provider?: 'unsplash' | 'wikimedia' | null;
  author_url?: string | null;
  /** cor média: fundo enquanto carrega */
  color?: string | null;
  /** prévia borrada enquanto carrega */
  blur_hash?: string | null;
}

// Prévia do blurhash em 32×32, decodificada uma vez por hash (o navegador estica com suavização).
const blurCache = new Map<string, string>();
function useBlur(hash: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() => (hash ? blurCache.get(hash) ?? null : null));
  useEffect(() => {
    if (!hash) return setUrl(null);
    const hit = blurCache.get(hash);
    if (hit) return setUrl(hit);
    let alive = true;
    void import('blurhash').then(({ decode, isBlurhashValid }) => {
      if (!alive || !isBlurhashValid(hash).result) return;
      const px = decode(hash, 32, 32);
      const c = document.createElement('canvas');
      c.width = 32;
      c.height = 32;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      const img = ctx.createImageData(32, 32);
      img.data.set(px);
      ctx.putImageData(img, 0, 0);
      const data = c.toDataURL();
      blurCache.set(hash, data);
      setUrl(data);
    }).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [hash]);
  return url;
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
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const figRef = useRef<HTMLElement>(null);
  // Crédito escrito na foto (diretriz do Unsplash) quando ela aparece grande; em miniatura, o ⓘ.
  const [roomy, setRoomy] = useState(false);
  const [inLink, setInLink] = useState(false);
  const has = !!photo?.url && !failed;
  // Proporção conhecida (sem altura fixa): o Unsplash recorta pela área mais interessante em vez do centro.
  const crop = height === undefined ? parseRatio(ratio ?? '4/3') : null;
  const blur = useBlur(has ? photo?.blur_hash : null);
  const bg = has && photo?.color && /^#[0-9A-Fa-f]{6}$/.test(photo.color) ? photo.color : undefined;
  const style: React.CSSProperties = {
    borderRadius: radius, ...(height !== undefined ? { height } : { aspectRatio: ratio ?? '4/3' }),
    ...(bg ? { backgroundColor: bg } : {}), ...(blur ? { backgroundImage: `url(${blur})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}),
  };
  const srcSet = !plain && photo?.url ? photoSrcSet(photo.url, undefined, crop) : null;
  const unsplash = !!photo?.url && (photo.provider === 'unsplash' || isUnsplashImage(photo.url));
  const hasCredit = has && (photo?.author || photo?.license);
  useEffect(() => setLoaded(false), [photo?.url]);
  useEffect(() => {
    const el = figRef.current;
    if (!el) return;
    const check = () => setRoomy(el.offsetWidth >= 180 && el.offsetHeight >= 100);
    check();
    // dentro de um link ou botão, o crédito vira texto (link dentro de link não vale)
    setInLink(!!el.parentElement?.closest('a, button'));
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const byline = has && unsplash && roomy;
  // Foto já no cache do navegador: o onLoad pode ter acontecido antes da hidratação.
  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current.naturalWidth) setLoaded(true);
  }, [photo?.url, srcSet]);
  return (
    <figure ref={figRef} className={`${s.photo} ${className ?? ''}`} style={style}>
      {has ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={imgRef}
          className={s.img}
          data-loaded={loaded ? '' : undefined}
          src={plain ? photo!.url : photoSrc(photo!.url, crop)}
          srcSet={srcSet ?? undefined}
          sizes={srcSet ? sizes : undefined}
          alt={alt ?? (place ? `Foto de ${place}` : '')}
          width={photo!.width ?? undefined}
          height={photo!.height ?? undefined}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => (srcSet && !plain ? setPlain(true) : setFailed(true))}
        />
      ) : (
        <Placeholder label={alt ?? (place ? `Ilustração: ${place} (sem foto)` : undefined)} />
      )}
      {overlay ? <span className={s.overlay} aria-hidden="true" /> : null}
      {children ? <div className={s.content}>{children}</div> : null}
      {byline ? (
        <figcaption className={s.byline}>
          Foto: {photo!.author_url && !inLink ? <a href={photo!.author_url} target="_blank" rel="noopener noreferrer">{photo!.author || 'autor'}</a> : photo!.author || 'autor'}
          {' / '}
          {!inLink ? <a href={photo!.source_url || `https://unsplash.com/?${UNSPLASH_UTM}`} target="_blank" rel="noopener noreferrer">Unsplash</a> : 'Unsplash'}
        </figcaption>
      ) : caption && place && has ? <figcaption className={s.caption}>foto · {place}</figcaption> : null}
      {hasCredit && !byline ? (
        <>
          <button type="button" className={s.info} aria-label="Crédito da foto" aria-expanded={credit} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setCredit((v) => !v); }}>
            <Icon name="info" size={14} />
          </button>
          {credit ? (
            <span className={s.credit} role="note">
              {unsplash ? (
                <>
                  Foto: {photo!.author_url ? <a href={photo!.author_url} target="_blank" rel="noopener noreferrer">{photo!.author || 'autor'}</a> : photo!.author || 'autor'}
                  {' no '}
                  <a href={photo!.source_url || `https://unsplash.com/?${UNSPLASH_UTM}`} target="_blank" rel="noopener noreferrer">Unsplash</a>
                </>
              ) : (
                <>
                  {photo!.author ? <>Foto: {photo!.author}</> : null}
                  {photo!.license ? <> · {photo!.license}</> : null}
                  {photo!.source_url ? <> · <a href={photo!.source_url} target="_blank" rel="noopener noreferrer">fonte</a></> : null}
                </>
              )}
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
