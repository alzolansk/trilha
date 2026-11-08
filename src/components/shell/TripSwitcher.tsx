'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useAuth } from '../../data/AuthContext';
import { useTrip } from '../../data/TripContext';
import type { Trip } from '../../data/types';
import { DEMO_KEYS, type DemoKey } from '../../lib/demo/build';
import { tripTarget } from '../../lib/derive';
import { DICTIONARY_ACCENT, tripAccent } from '../../lib/identity/accent';
import { countdown } from '../../lib/time';
import { Button } from '../ui/Button';
import { LogoMark } from '../ui/Logo';
import { Placeholder } from '../ui/Photo';
import { Icon } from '../ui/primitives';
import { Sheet } from '../ui/Sheet';
import s from './shell.module.css';

const DEMO_NAME: Record<DemoKey, string> = { andes: 'Peru + Bolívia', japao: 'Japão', marrocos: 'Marrocos', islandia: 'Islândia' };

function whenLabel(trip: Trip): string {
  const c = countdown(Date.now(), tripTarget(trip), trip.departure_tz || 'America/Sao_Paulo');
  if (trip.end_date < new Date().toISOString().slice(0, 10)) return 'Viagem concluída';
  if (c.totalDays <= 0) return 'Acontecendo agora';
  return `Faltam ${c.totalDays} ${c.totalDays === 1 ? 'dia' : 'dias'}`;
}

function TripThumb({ accent }: { accent: string }) {
  return (
    <span className={s.thumb} style={{ ['--trip-accent' as string]: accent }} aria-hidden="true">
      <Placeholder />
    </span>
  );
}

/** Seletor de trilhas em Sheet (planning §6.7). Substitui o IdentityMenu. */
export function TripSwitcherSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { source, base } = useTrip();
  const { trips, user } = useAuth();
  const demo = source.kind === 'demo';
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={demo ? 'Demonstrações' : 'Minhas trilhas'}
      description={demo ? 'Dados fictícios. Nada do que você fizer aqui é salvo.' : undefined}
      footer={
        demo ? (
          <>
            {user ? <Button variant="secondary" href="/" onClick={onClose}>Minhas trilhas</Button> : <Button variant="secondary" href="/entrar" onClick={onClose}>Entrar</Button>}
            <Button href="/nova-trilha" icon="plus" onClick={onClose}>Criar trilha real</Button>
          </>
        ) : (
          <>
            <Button variant="secondary" href="/conta" onClick={onClose}>Conta</Button>
            <Button href="/nova-trilha" icon="plus" onClick={onClose}>Nova trilha</Button>
          </>
        )
      }
    >
      <ul className={s.tripList}>
        {demo
          ? DEMO_KEYS.map((k) => (
              <li key={k}>
                <Link href={`/demo/${k}`} className={s.tripItem} aria-current={base === `/demo/${k}` ? 'true' : undefined} onClick={onClose}>
                  <TripThumb accent={DICTIONARY_ACCENT[k]} />
                  <span className={s.tripText}>
                    <b>{DEMO_NAME[k]}</b>
                    <span>Demonstração</span>
                  </span>
                  <Icon name="next" className={s.tripChev} />
                </Link>
              </li>
            ))
          : (trips ?? []).map(({ trip }) => (
              <li key={trip.id}>
                <Link href={`/t/${trip.id}`} className={s.tripItem} aria-current={trip.id === source.tripId ? 'true' : undefined} onClick={onClose}>
                  <TripThumb accent={tripAccent(trip)} />
                  <span className={s.tripText}>
                    <b>{trip.title}</b>
                    <span>{trip.destinations.length ? whenLabel(trip) : 'Planejando, sem destino ainda'}</span>
                  </span>
                  <Icon name="next" className={s.tripChev} />
                </Link>
              </li>
            ))}
      </ul>
    </Sheet>
  );
}

/** Botão que abre o seletor. `hero`: logo + "Minhas trilhas" no topo da Início (celular). `side`: pill na SideNav. */
export function TripSwitcherButton({ variant }: { variant: 'hero' | 'side' }) {
  const [open, setOpen] = useState(false);
  const { bundle, source } = useTrip();
  const demo = source.kind === 'demo';
  return (
    <>
      {variant === 'hero' ? (
        <button type="button" className={s.heroSwitch} onClick={() => setOpen(true)} aria-haspopup="dialog">
          <LogoMark size={30} />
          {demo ? 'Demonstrações' : 'Minhas trilhas'}
        </button>
      ) : (
        <button type="button" className={s.sideSwitch} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label={`Trilha atual: ${bundle?.trip.title ?? ''}. Trocar de trilha`}>
          <span className={s.sideDot} aria-hidden="true" />
          <span className={s.sideTitle}>{bundle?.trip.title ?? 'Trilha'}</span>
          <Icon name="swap" size={16} />
        </button>
      )}
      <TripSwitcherSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
