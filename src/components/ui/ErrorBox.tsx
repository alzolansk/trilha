import { Icon } from './primitives';
import { Button } from './Button';

/** Erro com mensagem humana (`humanError`) e "Tentar de novo". */
export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="errbox" role="alert">
      <Icon name="alert" />
      <span style={{ flex: 1, minWidth: 0 }}>{message}</span>
      {onRetry ? (
        <Button size="sm" variant="secondary" style={{ background: 'var(--surface)' }} onClick={onRetry}>
          Tentar de novo
        </Button>
      ) : null}
    </div>
  );
}
