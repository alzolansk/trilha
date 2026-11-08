'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useAuth } from '../../data/AuthContext';
import { useTrip } from '../../data/TripContext';
import { grantMissingKeys } from '../../data/docKeys';
import { syncOffline } from '../../data/offlineSync';
import { useVault } from '../../data/VaultContext';
import { track } from '../../lib/analytics';
import { ErrorBox } from '../ui/ErrorBox';
import { SideNav, SideNavLink } from '../ui/SideNav';
import { ScreenSkeleton } from '../ui/Skeleton';
import { TabBar, type NavItem } from '../ui/TabBar';
import type { IconName } from '../ui/icons.data';
import { warmTripPages } from './ServiceWorker';
import { ThemeApplier } from './ThemeApplier';
import { TripSwitcherButton } from './TripSwitcher';
import s from './shell.module.css';

/** As 4 abas (planning §4). `match`: prefixos de rota que ativam a aba. */
const TABS: { path: string; label: string; icon: IconName; match: string[] }[] = [
  { path: '', label: 'Início', icon: 'home', match: ['', '/descobrir'] },
  { path: '/roteiro', label: 'Roteiro', icon: 'route', match: ['/roteiro'] },
  { path: '/dinheiro', label: 'Dinheiro', icon: 'wallet', match: ['/dinheiro'] },
  { path: '/turma', label: 'Turma', icon: 'users', match: ['/turma', '/ajustes'] },
];

/** Subtelas com CTA fixa no rodapé escondem a TabBar (planning §4.1). */
const HIDE_TABBAR = ['/dinheiro/orcamento'];

function activeTab(rel: string): number {
  for (let i = TABS.length - 1; i > 0; i--) if (TABS[i].match.some((m) => rel === m || rel.startsWith(`${m}/`))) return i;
  return 0;
}

/** Guarda a rolagem de cada aba e devolve ao voltar para ela (planning §4.1). */
function useTabScroll(path: string) {
  const pos = useRef(new Map<string, number>());
  useEffect(() => {
    const y = pos.current.get(path);
    if (y !== undefined) requestAnimationFrame(() => window.scrollTo(0, y));
    else window.scrollTo(0, 0);
    let t = 0;
    const onScroll = () => {
      cancelAnimationFrame(t);
      t = requestAnimationFrame(() => pos.current.set(path, window.scrollY));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(t);
      window.removeEventListener('scroll', onScroll);
    };
  }, [path]);
}

export function TripShell({ children }: { children: React.ReactNode }) {
  const { base, bundle, accent, loading, error, reload, stale, staleSince, source } = useTrip();
  const { online, user } = useAuth();
  const vault = useVault();
  const path = usePathname();
  const rel = path.slice(base.length).replace(/\/$/, '');
  const isHome = rel === '';
  const tab = activeTab(rel);
  const demo = source.kind === 'demo';
  // Fade curto só em navegações (no primeiro carregamento o HTML do servidor aparece direto).
  const firstPath = useRef(path);
  const navigated = path !== firstPath.current;
  useTabScroll(path);

  useEffect(() => {
    if (bundle && source.kind === 'supabase') {
      warmTripPages(base);
      track('trip.open', {}, bundle.trip.id);
    }
  }, [bundle?.trip.id, base, source.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  // Baixa/limpa cópias offline sempre que os documentos mudam ou a conexão volta.
  useEffect(() => {
    if (bundle && source.kind === 'supabase' && online) syncOffline(source, bundle);
  }, [bundle, source, online]);

  // Libera chaves de documentos cifrados para quem da turma ainda não tem.
  useEffect(() => {
    if (!bundle || !user || source.kind !== 'supabase' || !online || vault.status !== 'unlocked') return;
    void grantMissingKeys(source, bundle, user.id, vault.docKey).then((n) => (n ? reload() : undefined));
  }, [bundle, source, online, user, vault.status, vault.docKey, reload]);

  useEffect(() => {
    document.body.dataset.route = isHome ? 'inicio' : rel.split('/')[1] ?? '';
    return () => {
      delete document.body.dataset.route;
    };
  }, [isHome, rel]);

  const items: NavItem[] = TABS.map((t, i) => ({ href: base + t.path, label: t.label, icon: t.icon, active: i === tab }));
  return (
    <div className={s.shell}>
      <ThemeApplier accent={bundle ? accent : null} />
      {/* --trip-accent também no HTML do servidor (sem piscar a cor padrão antes de hidratar). */}
      {bundle ? <style dangerouslySetInnerHTML={{ __html: `:root{--trip-accent:${accent.replace(/[^#0-9a-fA-F]/g, '')}}` }} /> : null}

      <SideNav
        items={items}
        home={base}
        tripSwitcher={bundle ? <TripSwitcherButton variant="side" /> : null}
        footer={
          <>
            {demo ? <span className={s.demoSide}>Demonstração · nada é salvo</span> : null}
            {!demo ? <SideNavLink href={`${base}/ajustes`} icon="settings">Ajustes da trilha</SideNavLink> : null}
            {demo ? <SideNavLink href="/nova-trilha" icon="plus">Criar trilha real</SideNavLink> : <SideNavLink href="/nova-trilha" icon="plus">Nova trilha</SideNavLink>}
            {user ? <SideNavLink href="/conta" icon="users">Conta</SideNavLink> : <SideNavLink href="/entrar" icon="users">Entrar</SideNavLink>}
          </>
        }
      />

      <div className={s.content}>
        {demo ? (
          <div className={s.notice} role="note">
            <span><b>Demonstração</b><span className={s.noticeLong}> · dados fictícios, nada é salvo</span></span>
            <Link href="/nova-trilha">Criar trilha real</Link>
          </div>
        ) : null}
        {stale && bundle ? (
          <div className={s.notice} role="status">
            <span>{staleSince ? `Mostrando cópia salva de ${new Date(staleSince).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'Mostrando a cópia salva neste aparelho'}{online ? '. Atualizando…' : '.'}</span>
          </div>
        ) : null}

        <main id="main" className={`${s.main} ${navigated ? 'view' : ''}`} key={rel}>
          {bundle ? (
            children
          ) : error ? (
            <div className="wrap" style={{ paddingTop: 96 }}>
              <ErrorBox message={error} onRetry={() => void reload()} />
              <p style={{ marginTop: 20 }}>
                <Link href="/">Voltar para minhas trilhas</Link>
              </p>
            </div>
          ) : loading ? (
            <ScreenSkeleton />
          ) : null}
        </main>
      </div>

      <TabBar items={items} hidden={HIDE_TABBAR.some((p) => rel === p)} />
    </div>
  );
}
