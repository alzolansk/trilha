import { LogoMark } from './Logo';
import s from './StepChat.module.css';

/** Conversa passo a passo (Orçamento, Descobrir): bolha da Trilha, resposta e bloco de opções. */
export function StepChat({ children, label }: { children: React.ReactNode; label?: string }) {
  return <div className={s.chat} role="log" aria-label={label ?? 'Conversa com a Trilha'}>{children}</div>;
}

/** Bolha da Trilha, com o logo de 30 px. */
export function TrilhaBubble({ children, step }: { children: React.ReactNode; step?: string }) {
  return (
    <div className={s.trilha}>
      <LogoMark size={30} />
      <div className={s.bubbleT}>
        {step ? <span className={s.step}>{step}</span> : null}
        {children}
      </div>
    </div>
  );
}

/** Resposta de quem usa (brand, à direita). Clicável para editar a resposta. */
export function ReplyBubble({ children, onEdit }: { children: React.ReactNode; onEdit?: () => void }) {
  if (onEdit) {
    return (
      <div className={s.reply}>
        <button type="button" className={s.bubbleR} onClick={onEdit} aria-label="Editar esta resposta">{children}</button>
      </div>
    );
  }
  return <div className={s.reply}><div className={s.bubbleR}>{children}</div></div>;
}

/** Bloco de opções abaixo da pergunta (chips, cartões, campos). */
export function ChatOptions({ children }: { children: React.ReactNode }) {
  return <div className={s.options}>{children}</div>;
}
