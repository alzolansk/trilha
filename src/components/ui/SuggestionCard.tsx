import { Button, IconButton } from './Button';
import { Photo, type PhotoData } from './Photo';
import { AiTag } from './primitives';
import s from './SuggestionCard.module.css';

/**
 * Sugestão da Trilha (planning §3.2): visual próprio, selo do motivo e ações padrão
 * `[Pôr no dia N] [Votar] [✕ Dispensar]`. `inline` = versão tracejada dentro do roteiro.
 */
export function SuggestionCard({ reason, reasonTone = 'brand', title, text, photo, place, by, onAccept, acceptLabel, onVote, onDismiss, variant = 'card', busy }: {
  /** ex.: "Passeio · cabe no dia 4", "Falta você votar", "Reserve logo" */
  reason: string;
  reasonTone?: 'brand' | 'warn';
  title: React.ReactNode;
  text?: React.ReactNode;
  photo?: PhotoData | null;
  place?: string;
  /** origem do conteúdo: mostra o selo IA/AUTO */
  by?: 'ai' | 'rules';
  onAccept?: () => void;
  acceptLabel?: string;
  onVote?: () => void;
  onDismiss?: () => void;
  variant?: 'card' | 'inline';
  busy?: boolean;
}) {
  const showPhoto = photo !== undefined || place;
  return (
    <article className={`${s.card} ${variant === 'inline' ? s.inline : ''}`}>
      {showPhoto && variant === 'card' ? (
        <Photo photo={photo} place={place} ratio="7/3" radius="0">
          <span className={`${s.reason} ${s.onPhoto}`}>{reason}</span>
        </Photo>
      ) : null}
      <div className={s.body}>
        {!showPhoto || variant === 'inline' ? (
          <span className={`${s.reason} ${reasonTone === 'warn' ? s.warn : ''}`}>{reason}</span>
        ) : null}
        <div className={s.titleRow}>
          <h3 className={s.title}>{title}</h3>
          {by ? <AiTag by={by} /> : null}
        </div>
        {text ? <p className={s.text}>{text}</p> : null}
        {onAccept || onVote || onDismiss ? (
          <div className={s.actions}>
            {onAccept ? <Button size="sm" onClick={onAccept} disabled={busy} className={s.grow}>{acceptLabel ?? 'Aceitar'}</Button> : null}
            {onVote ? <Button size="sm" variant="secondary" onClick={onVote} disabled={busy}>Votar</Button> : null}
            {onDismiss ? <IconButton icon="close" label="Dispensar sugestão" size={40} onClick={onDismiss} disabled={busy} /> : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}
