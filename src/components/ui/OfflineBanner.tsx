'use client';
import { Icon } from './primitives';

/** Faixa no topo quando não há conexão. Ler funciona com cache; escrever pede internet. */
export function OfflineBanner({ online }: { online: boolean }) {
  if (online) return null;
  return (
    <div className="banner-offline" role="status">
      <Icon name="cloud" size={18} />
      Sem internet. Dá pra consultar tudo; para salvar, precisa de conexão.
    </div>
  );
}
