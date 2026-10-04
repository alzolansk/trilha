'use client';
import Link from 'next/link';
import { IdentityCard } from '../../components/identity/IdentityCard';
import { PageTitle, useReveal } from '../../components/ui/primitives';
import { useAuth } from '../../data/AuthContext';
import { DICTIONARY, DICTIONARY_ORDER } from '../../lib/identity/dictionary';

const DEST: Record<string, string> = { andes: 'Peru + Bolívia', japao: 'Japão', marrocos: 'Marrocos', islandia: 'Islândia' };

export default function Identidades() {
  const { user } = useAuth();
  useReveal([]);
  return (
    <main id="main" className="wrap">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 20 }}>
        <Link href="/" style={{ fontFamily: 'var(--font-display)', fontSize: 24, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="motif" style={{ width: 18, height: 18, background: 'var(--acc)' }} />trilha
        </Link>
        <Link className="btn btn-sm tap" href={user ? '/nova-trilha' : '/entrar'}>{user ? 'Nova trilha' : 'Entrar'}</Link>
      </header>
      <PageTitle eyebrow="Sistema de identidade por destino" title="Uma trilha, quatro caras." sub="O que muda por destino: paleta, fonte display, padrão gráfico, formato da fenda e paisagem. O que fica: layout, fonte de texto, ritmo das animações e regras de contraste." />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(280px,100%),1fr))', gap: 22, marginTop: 40 }}>
        {DICTIONARY_ORDER.map((k) => (
          <div key={k} className="rv">
            <IdentityCard identity={DICTIONARY[k]} title={DEST[k]} action={
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 'auto' }}>
                <Link className="btn tap" style={{ background: DICTIONARY[k].palette.ink, color: DICTIONARY[k].palette.bg, border: 0, justifyContent: 'center', flex: 1 }} href={`/demo/${k}`}>Ver demonstração</Link>
                {user ? <Link className="btn tap" style={{ justifyContent: 'center', flex: 1 }} href={`/nova-trilha?identidade=${k}`}>Usar esta identidade</Link> : null}
              </div>
            } />
          </div>
        ))}
      </div>
      <p className="mono" style={{ marginTop: 40, fontSize: 12, color: 'var(--mute)' }}>AS DEMONSTRAÇÕES USAM DADOS FICTÍCIOS E NÃO SALVAM NADA.</p>
    </main>
  );
}
