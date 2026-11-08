'use client';
import Link from 'next/link';
import { forwardRef } from 'react';
import { Icon } from './primitives';
import type { IconName } from './icons.data';
import s from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'dark' | 'ghost' | 'dashed';
export type ButtonSize = 'md' | 'sm';

interface Common {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  icon?: IconName;
  /** ícone depois do texto (ex.: ↗ em links externos) */
  iconEnd?: IconName;
  className?: string;
  children?: React.ReactNode;
}

type AsButton = Common & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'> & { href?: undefined };
type AsLink = Common & { href: string; external?: boolean; onClick?: React.MouseEventHandler<HTMLAnchorElement>; 'aria-label'?: string };

export function buttonClass({ variant = 'primary', size = 'md', block, className }: Pick<Common, 'variant' | 'size' | 'block' | 'className'>) {
  return [s.btn, s[variant], s[size], block ? s.block : '', className ?? ''].filter(Boolean).join(' ');
}

/** Botão do sistema (planning §3.3). Com `href` vira link com a mesma aparência. */
export const Button = forwardRef<HTMLButtonElement, AsButton | AsLink>(function Button(props, ref) {
  const { variant, size, block, icon, iconEnd, className, children } = props;
  const cls = buttonClass({ variant, size, block, className });
  const inner = (
    <>
      {icon ? <Icon name={icon} size={size === 'sm' ? 16 : 18} /> : null}
      {children}
      {iconEnd ? <Icon name={iconEnd} size={size === 'sm' ? 16 : 18} /> : null}
    </>
  );
  if (props.href !== undefined) {
    const { href, external, onClick } = props as AsLink;
    if (external) {
      return (
        <a className={cls} href={href} target="_blank" rel="noopener noreferrer" onClick={onClick} aria-label={props['aria-label']}>
          {inner}
        </a>
      );
    }
    return (
      <Link className={cls} href={href} onClick={onClick} aria-label={props['aria-label']}>
        {inner}
      </Link>
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { variant: _v, size: _s, block: _b, icon: _i, iconEnd: _ie, className: _c, children: _ch, type = 'button', ...rest } = props as AsButton;
  return (
    <button ref={ref} type={type} className={cls} {...rest}>
      {inner}
    </button>
  );
});

/** Botão só de ícone: 44×44, redondo, `aria-label` obrigatório. */
export function IconButton({ icon, label, variant = 'secondary', size = 44, className, ...rest }: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & { icon: IconName; label: string; variant?: 'secondary' | 'ghost' | 'dark' | 'light'; size?: 40 | 44 }) {
  return (
    <button type="button" aria-label={label} title={label} className={[s.icon, s[`i_${variant}`], size === 40 ? s.i40 : '', className ?? ''].filter(Boolean).join(' ')} {...rest}>
      <Icon name={icon} size={20} />
    </button>
  );
}
