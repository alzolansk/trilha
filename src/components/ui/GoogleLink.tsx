'use client';
import { googleSearchUrl } from '../../lib/photos';
import { Icon } from './primitives';
import s from './GoogleLink.module.css';

/**
 * Busca no Google (nova aba) para conferir fotos, avaliações e como é um passeio ou lugar antes de decidir.
 * Para o toque: dentro de carta arrastável, o toque no link não pode virar início de arraste.
 */
export function GoogleLink({ what, where, compact = false }: { what: string; where?: string | null; compact?: boolean }) {
  return (
    <a
      className={s.link} data-compact={compact ? 'true' : undefined} href={googleSearchUrl(what, where)} target="_blank" rel="noopener noreferrer"
      aria-label={`Pesquisar “${what}” no Google (abre em nova aba)`} title="Pesquisar no Google"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <Icon name="search" size={compact ? 14 : 16} />{compact ? null : <span>Google</span>}
    </a>
  );
}
