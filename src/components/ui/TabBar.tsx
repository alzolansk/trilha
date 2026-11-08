'use client';
import Link from 'next/link';
import { Icon } from './primitives';
import type { IconName } from './icons.data';
import s from './TabBar.module.css';

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  active: boolean;
}

/** Barra de abas flutuante do celular (planning §4.1). */
export function TabBar({ items, hidden }: { items: NavItem[]; hidden?: boolean }) {
  return (
    <nav className={`${s.bar} ${hidden ? s.hidden : ''}`} aria-label="Abas">
      {items.map((it) => (
        <Link key={it.label} href={it.href} className={s.tab} aria-current={it.active ? 'page' : undefined}>
          <Icon name={it.icon} size={22} />
          {it.label}
        </Link>
      ))}
    </nav>
  );
}
