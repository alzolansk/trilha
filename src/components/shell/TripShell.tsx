'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../data/AuthContext';
import { useTrip } from '../../data/TripContext';
import { syncOffline } from '../../data/offlineSync';
import { track } from '../../lib/analytics';
import { DEMO_KEYS } from '../../lib/demo/build';
import { DICTIONARY } from '../../lib/identity/dictionary';
import { ErrorBox, Icon, Pattern, Skeleton } from '../ui/primitives';
import type { IconName } from '../ui/icons.data';
import { ThemeApplier } from './ThemeApplier';
import { cycleExtras, themeVars } from '../../lib/identity/theme';
import { LOCAL_DISPLAY } from '../../lib/identity/fontmap';
import { fallbackFor } from '../../lib/identity/validate';
import { warmTripPages } from './ServiceWorker';
import styles from './shell.module.css';

const NAV: [string, string, string, IconName][] = [
  ['', 'Início', 'Início', 'home'],
  ['/roteiro', 'Roteiro', 'Roteiro', 'map'],
  ['/documentos', 'Documentos', 'Docs', 'doc'],
  ['/mala', 'Mala e gastos', 'Mala', 'bag'],
  ['/diario', 'Diário', 'Diário', 'book'],
];

function IdentityMenu() {
  const { identity, source, bundle } = useTrip();
  const { trips, user } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('click', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const demo = source.kind === 'demo';
  return (
    <div ref={ref} className={styles.idwrap}>
      <button className={`${styles.idpill} tap`} aria-haspopup="true" aria-expanded={open} aria-label={`Identidade ${identity.idName}: trocar de trilha`} onClick={() => setOpen((v) => !v)}>
        <span className={styles.dots} aria-hidden="true">
          <span style={{ background: 'var(--acc)' }} />
          <span style={{ background: 'var(--acc2)' }} />
          <span style={{ background: 'var(--deep)' }} />
        </span>
        <span className={styles.lbl}>
          Identidade <b>{identity.idName}</b>
        </span>
      </button>
      {open ? (
        <div className={styles.idmenu} role="menu">
          {demo ? (
            <>
              <span className={styles.menuHead}>Demonstração · dados fictícios</span>
              {DEMO_KEYS.map((k) => (
                <Link key={k} role="menuitem" href={`/demo/${k}`} aria-current={bundle?.trip.identity?.key === k ? 'true' : undefined} onClick={() => setOpen(false)}>
                  <span className={styles.sw} style={{ clipPath: DICTIONARY[k].motif, background: DICTIONARY[k].palette.acc }} />
                  <span>
                    <b>{k === 'andes' ? 'Peru + Bolívia' : k === 'japao' ? 'Japão' : k === 'marrocos' ? 'Marrocos' : 'Islândia'}</b>
                    <br />
                    <span className="mono" style={{ fontSize: 11, opacity: 0.7 }}>{DICTIONARY[k].idName.toUpperCase()}</span>
                  </span>
                </Link>
              ))}
              {user ? <Link role="menuitem" href="/"><Icon name="home" />Minhas trilhas</Link> : <Link role="menuitem" href="/entrar"><Icon name="users" />Entrar</Link>}
            </>
          ) : (
            <>
              <span className={styles.menuHead}>Suas trilhas</span>
              {(trips ?? []).map(({ trip }) => (
                <Link key={trip.id} role="menuitem" href={`/t/${trip.id}`} aria-current={trip.id === source.tripId ? 'true' : undefined} onClick={() => setOpen(false)}>
                  <span className={styles.sw} style={{ clipPath: trip.identity?.motif ?? 'circle(50%)', background: trip.identity?.palette.acc ?? 'var(--ink)' }} />
                  <span>
                    <b>{trip.title}</b>
                    <br />
                    <span className="mono" style={{ fontSize: 11, opacity: 0.7 }}>{(trip.identity?.idName ?? '').toUpperCase()}</span>
                  </span>
                </Link>
              ))}
              <Link role="menuitem" href={`/t/${source.tripId}/turma`}><Icon name="users" />Turma e convites</Link>
              <Link role="menuitem" href={`/t/${source.tripId}/editar`}><Icon name="edit" />Dados da trilha</Link>
              <Link role="menuitem" href="/nova-trilha"><Icon name="plus" />Nova trilha</Link>
              <Link role="menuitem" href="/identidades"><Icon name="sparkle" />Ver todas as identidades</Link>
              <Link role="menuitem" href="/conta"><Icon name="cal" />Conta e notificações</Link>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function TripShell({ children }: { children: React.ReactNode }) {
  const { base, bundle, identity, loading, error, reload, stale, source } = useTrip();
  const { online } = useAuth();
  const path = usePathname();
  const rel = path.slice(base.length) || '';
  const isHome = rel === '' || rel === '/';
  // Fade de entrada só em navegações (no primeiro carregamento o HTML do servidor aparece direto).
  const firstPath = useRef(path);
  const navigated = path !== firstPath.current;

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

  useEffect(() => {
    document.body.dataset.route = isHome ? 'inicio' : rel.split('/')[1] ?? '';
    return () => {
      delete document.body.dataset.route;
    };
  }, [isHome, rel]);

  return (
    <>
      <ThemeApplier identity={bundle ? identity : null} />
      {bundle ? (
        // Tokens também no HTML do servidor: evita o "piscar" do tema neutro antes de hidratar.
        <style
          dangerouslySetInnerHTML={{
            __html: `:root{${Object.entries({ ...themeVars(identity), ...cycleExtras(identity), '--font-display': `${LOCAL_DISPLAY[identity.display.family] ? `${LOCAL_DISPLAY[identity.display.family]}, ` : ''}'${identity.display.family}', ${fallbackFor(identity.display.family)}` })
              .map(([k, v]) => `${k}:${v.replace(/[<>{}]/g, '')}`)
              .join(';')}}`,
          }}
        />
      ) : null}
      {bundle ? (
        <div className="bg-pattern">
          <Pattern identity={identity} />
        </div>
      ) : null}
      {source.kind === 'demo' ? (
        <div className="banner-demo" role="note">
          <span>DEMO<span className="demo-long">NSTRAÇÃO · DADOS FICTÍCIOS · NADA É SALVO</span></span>
          <Link href="/nova-trilha" style={{ textDecoration: 'underline' }}>Criar trilha real</Link>
        </div>
      ) : null}
      <header className={`${styles.top} ${isHome ? styles.fixed : ''}`}>
        <div className={styles.topIn}>
          <Link href={base} className={styles.logo}>
            <span className="motif" aria-hidden="true" />
            trilha
          </Link>
          <nav className={styles.nav} aria-label="Principal">
            {NAV.map(([p, label]) => (
              <Link key={p} href={base + p} aria-current={(p === '' ? isHome : rel.startsWith(p)) ? 'page' : undefined}>
                {label}
              </Link>
            ))}
          </nav>
          {bundle ? <IdentityMenu /> : <span />}
        </div>
      </header>
      {stale && online && bundle ? (
        <div className={styles.stale} role="status">Mostrando a cópia salva neste aparelho. Atualizando…</div>
      ) : null}
      <main id="main" className={navigated ? 'view' : undefined} key={rel}>
        {bundle ? (
          children
        ) : error ? (
          <div className="wrap" style={{ paddingTop: 120 }}>
            <ErrorBox message={error} onRetry={() => void reload()} />
            <p style={{ marginTop: 20 }}>
              <Link href="/">Voltar para minhas trilhas</Link>
            </p>
          </div>
        ) : loading ? (
          <div className="wrap" style={{ paddingTop: 120, display: 'grid', gap: 20 }} aria-busy="true">
            <span className="sr">Carregando a trilha…</span>
            <Skeleton h={90} w="60%" />
            <Skeleton h={320} />
            <Skeleton h={180} />
          </div>
        ) : null}
      </main>
      <nav className={styles.tabbar} aria-label="Principal (celular)">
        {NAV.map(([p, , short, icon]) => (
          <Link key={p} href={base + p} className="tap" aria-current={(p === '' ? isHome : rel.startsWith(p)) ? 'page' : undefined}>
            <Icon name={icon} size={22} />
            {short}
          </Link>
        ))}
      </nav>
    </>
  );
}
