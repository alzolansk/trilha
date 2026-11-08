'use client';
import { useEffect, useId, useRef } from 'react';
import { IconButton } from './Button';
import s from './Sheet.module.css';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** ações fixas no rodapé (no celular ficam presas embaixo, acima da área segura) */
  footer?: React.ReactNode;
  labelledBy?: string;
  /** texto curto abaixo do título */
  description?: React.ReactNode;
  /** botão Voltar do Android/navegador fecha o sheet (padrão: sim) */
  closeOnBack?: boolean;
  size?: 'md' | 'lg';
}

let seq = 0;

/**
 * `<dialog>` que vira bottom sheet no celular (≤ 820 px) e modal de 560 px no desktop (planning §3.3).
 * Foco preso pelo próprio `showModal`, Esc fecha, toque fora fecha e Voltar fecha (entrada no histórico).
 * Mesma API do antigo `Dialog`.
 */
export function Sheet({ open, onClose, title, children, footer, labelledBy, description, closeOnBack = true, size = 'md' }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const autoId = useId();
  const id = labelledBy ?? `sheet-${autoId.replace(/[^a-zA-Z0-9]/g, '')}`;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Um link dentro do sheet navega: aí não tiramos a entrada do histórico (o back() desfaria a navegação).
  const navigating = useRef(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  // Voltar do Android fecha o sheet: empurra uma entrada no histórico enquanto ele está aberto.
  useEffect(() => {
    if (!open || !closeOnBack || typeof window === 'undefined') return;
    const key = `s${++seq}`;
    navigating.current = false;
    let pushed = false;
    let poppedByUser = false;
    const onPop = () => {
      if (window.history.state?.__sheet === key) return; // voltou de um sheet aninhado para este
      poppedByUser = true;
      onCloseRef.current();
    };
    // Adiado um tick: no StrictMode o efeito monta, desmonta e monta de novo na mesma hora;
    // assim só uma entrada é empurrada.
    const t = setTimeout(() => {
      window.history.pushState({ ...(window.history.state ?? {}), __sheet: key }, '');
      pushed = true;
      window.addEventListener('popstate', onPop);
    }, 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('popstate', onPop);
      // Fechou por botão/Esc: tira a entrada que empurramos, se ainda estivermos nela.
      // Adiado um tick e conferido de novo: se a ação navegou (link ou router.push imediato),
      // a entrada já não é a nossa e fica como está (Voltar depois só repete a tela anterior).
      if (!pushed || poppedByUser || navigating.current) return;
      setTimeout(() => {
        if (!navigating.current && window.history.state?.__sheet === key) window.history.back();
      }, 0);
    };
  }, [open, closeOnBack]);

  return (
    <dialog
      ref={ref}
      className={`${s.sheet} ${size === 'lg' ? s.lg : ''}`}
      aria-labelledby={id}
      onClose={() => {
        if (open) onCloseRef.current();
      }}
      onCancel={(e) => {
        e.preventDefault();
        onCloseRef.current();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onCloseRef.current();
      }}
      onClickCapture={(e) => {
        const a = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
        if (a && !a.target && a.origin === window.location.origin) navigating.current = true;
      }}
    >
      {open ? (
        <div className={s.in}>
          <span className={s.handle} aria-hidden="true" />
          <header className={s.head}>
            <div className={s.titles}>
              <h2 id={id} className={s.title}>{title}</h2>
              {description ? <p className={s.desc}>{description}</p> : null}
            </div>
            <IconButton icon="close" label="Fechar" variant="secondary" size={40} onClick={() => onCloseRef.current()} />
          </header>
          <div className={s.body}>{children}</div>
          {footer ? <footer className={s.foot}>{footer}</footer> : null}
        </div>
      ) : null}
    </dialog>
  );
}
