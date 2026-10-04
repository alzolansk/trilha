import Link from 'next/link';

// Página de fallback do service worker quando a tela pedida não está no cache.
export default function Offline() {
  return (
    <main id="main" className="wrap" style={{ paddingTop: 120, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <h1 className="disp" style={{ fontSize: 'clamp(44px,7vw,96px)', margin: 0, lineHeight: 0.95 }}>Sem internet.</h1>
      <p style={{ fontSize: 18, maxWidth: 560, margin: 0 }}>Essa tela ainda não foi aberta neste aparelho, então não ficou guardada. As trilhas que você já abriu e os documentos baixados continuam disponíveis.</p>
      <Link className="btn btn-ink" href="/" style={{ alignSelf: 'flex-start' }}>Abrir minhas trilhas</Link>
    </main>
  );
}
