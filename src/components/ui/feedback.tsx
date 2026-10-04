'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ConflictError, humanError } from '../../data/source';

// ───── Toast (SPEC §7) ─────
const ToastCtx = createContext<(msg: string) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState('');
  const [on, setOn] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((m: string) => {
    setMsg(m);
    setOn(true);
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => setOn(false), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className={`toast${on ? ' on' : ''}`} role="status" aria-live="polite">
        {msg}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ───── Diálogo modal nativo ─────
export function Dialog({ open, onClose, title, children, footer, labelledBy }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode; labelledBy?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const id = labelledBy ?? `dlg-${title.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <dialog
      ref={ref}
      className="dlg"
      aria-labelledby={id}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open ? (
        <div className="dlg-in">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <h2 id={id} className="disp">{title}</h2>
            <button className="btn btn-icon btn-sm tap" aria-label="Fechar" onClick={onClose}>
              ✕
            </button>
          </div>
          {children}
          {footer ? <div className="dlg-foot">{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}

// ───── Confirmação de exclusão ─────
interface ConfirmOpts {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
}
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOpts | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);
  const ask = useCallback((o: ConfirmOpts) => {
    setOpts(o);
    return new Promise<boolean>((res) => (resolver.current = res));
  }, []);
  const done = (v: boolean) => {
    resolver.current?.(v);
    resolver.current = null;
    setOpts(null);
  };
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      <Dialog
        open={!!opts}
        onClose={() => done(false)}
        title={opts?.title ?? ''}
        footer={
          <>
            <button className="btn tap" onClick={() => done(false)}>
              Cancelar
            </button>
            <button className="btn btn-primary tap" onClick={() => done(true)} autoFocus>
              {opts?.confirmLabel ?? 'Excluir'}
            </button>
          </>
        }
      >
        <div style={{ fontSize: 16 }}>{opts?.message}</div>
      </Dialog>
    </ConfirmCtx.Provider>
  );
}
export const useConfirm = () => useContext(ConfirmCtx);

// ───── Execução de ações com erro humano, conflito e toast ─────
export function useAction() {
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, opts: { success?: string; onConflict?: () => Promise<T | void> } = {}): Promise<T | undefined> => {
      setBusy(true);
      try {
        const r = await fn();
        if (opts.success) toast(opts.success);
        return r;
      } catch (e) {
        if (e instanceof ConflictError && opts.onConflict) {
          const overwrite = await confirm({
            title: 'Alguém mexeu nisso',
            message: 'Outra pessoa salvou uma versão mais nova enquanto você editava. Quer sobrescrever com a sua? Se cancelar, a versão atual é carregada e nada se perde do que ela fez.',
            confirmLabel: 'Sobrescrever com a minha',
          });
          if (overwrite) {
            try {
              const r = (await opts.onConflict()) as T;
              if (opts.success) toast(opts.success);
              return r;
            } catch (e2) {
              toast(humanError(e2));
            }
          }
          return undefined;
        }
        toast(humanError(e));
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast, confirm],
  );
  return { run, busy };
}
