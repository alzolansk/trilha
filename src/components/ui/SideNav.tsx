'use client';
import Link from 'next/link';
import { Logo } from './Logo';
import { Icon } from './primitives';
import type { NavItem } from './TabBar';
import s from './SideNav.module.css';

/** Navegação lateral fixa do desktop (240 px): logo, seletor de trilha, 4 abas e rodapé (planning §4.2). */
export function SideNav({ items, home, tripSwitcher, footer }: { items: NavItem[]; home: string; tripSwitcher?: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <aside className={s.side}>
      <Link href={home} className={s.logo} aria-label="Trilha, início da trilha"><Logo size={34} /></Link>
      {tripSwitcher ? <div className={s.switcher}>{tripSwitcher}</div> : null}
      <nav aria-label="Principal" className={s.nav}>
        {items.map((it) => (
          <Link key={it.label} href={it.href} className={s.item} aria-current={it.active ? 'page' : undefined}>
            <Icon name={it.icon} size={22} />
            {it.label}
          </Link>
        ))}
      </nav>
      {footer ? <div className={s.foot}>{footer}</div> : null}
    </aside>
  );
}

export function SideNavLink({ href, icon, children, onClick }: { href?: string; icon: React.ComponentProps<typeof Icon>['name']; children: React.ReactNode; onClick?: () => void }) {
  if (href) return <Link href={href} className={s.sub}><Icon name={icon} size={18} />{children}</Link>;
  return <button type="button" className={s.sub} onClick={onClick}><Icon name={icon} size={18} />{children}</button>;
}
