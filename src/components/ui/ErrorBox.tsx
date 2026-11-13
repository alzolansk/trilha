import { Icon } from './primitives';

/** Erro com mensagem humana (`humanError`) e "Tentar de novo". */
export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="errbox" role="alert">
      <Icon name="alert" />
      <span style={{ flex: 1, minWidth: 0 }}>{message}</span>
      {onRetry ? (
        <button type="button" className="btn btn-sm tap" style={{ background: 'var(--surface)' }} onClick={onRetry}>
          Tentar de novo
        </button>
      ) : null}
    </div>
  );
}
